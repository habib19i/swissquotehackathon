// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/draft-ERC4337Utils.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/**
 * @title RulebookAccount
 * @notice The client's USDC safe on Base (CLAUDE.md sections 6 and 7). An ERC-4337 account with two keys:
 *
 * - the WALLET PASSKEY (Face ID, P-256 via WebAuthn) may only call {payContact}: pay an approved contact
 *   (Merkle proof against `contactsRoot`), within the daily limit, unless the safe is frozen;
 * - the 2-of-3 MPC key (secp256k1) may do anything: change the rulebook, run any call batch, replace the
 *   passkey after a recovery. Swissquote alone holds one share of it and can never sign alone.
 *
 * Signatures carry a one-byte prefix: 0x00 for the MPC key, 0x01 for the passkey.
 * Cryptography comes from OpenZeppelin (ECDSA, WebAuthn/P256 with the RIP-7212 precompile, MerkleProof).
 */
contract RulebookAccount is Account, ERC7821, IERC1271, Initializable {
    using SafeERC20 for IERC20;

    uint8 internal constant MPC_KEY = 0x00;
    uint8 internal constant PASSKEY = 0x01;
    uint256 internal constant WINDOW = 1 days;

    /// @notice The token daily payments are made in (USDC on Base Sepolia).
    IERC20 public immutable token;
    /// @notice Receives the USDC network-fee share on the Standard plan (Swissquote).
    address public immutable feeRecipient;

    /// @notice Ethereum address of the 2-of-3 MPC key.
    address public mpcSigner;
    /// @notice Public key of the wallet passkey (P-256).
    bytes32 public passkeyX;
    bytes32 public passkeyY;
    /// @notice Merkle root of the approved contacts (OpenZeppelin StandardMerkleTree, leaf = address).
    bytes32 public contactsRoot;
    /// @notice Most the passkey may pay per 24-hour window, in token units.
    uint256 public dailyLimit;
    /// @notice While frozen, the passkey cannot pay anyone.
    bool public frozen;
    /// @notice Contacts removed since the last root update: removal is instant, without a new root.
    mapping(address contact => bool) public revoked;

    uint256 public windowStart;
    uint256 public spentInWindow;

    event RulebookSet(bytes32 contactsRoot, uint256 dailyLimit);
    event ContactRevoked(address indexed contact);
    event FrozenSet(bool frozen);
    event PasskeySet(bytes32 x, bytes32 y);
    event ContactPaid(address indexed to, uint256 amount, uint256 fee);

    error OutsideRulebook();
    error DailyLimitExceeded(uint256 remaining);

    constructor(IERC20 token_, address feeRecipient_) {
        token = token_;
        feeRecipient = feeRecipient_;
        _disableInitializers();
    }

    function initialize(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) external initializer {
        mpcSigner = mpc;
        _setPasskey(x, y);
        _setRulebook(root, limit);
    }

    // ------------------------------------------------------------------ daily payments (passkey)

    /**
     * @notice Pays an approved contact within the daily limit. The only call the passkey may make.
     * @param fee USDC paid to Swissquote for the network fee (Standard plan); zero on Premium. It counts
     * towards the daily limit too, so a stolen phone cannot drain the safe through fees either.
     */
    function payContact(address to, uint256 amount, bytes32[] calldata proof, uint256 fee) external onlyEntryPointOrSelf {
        if (!_isPayable(to, proof)) revert OutsideRulebook();
        _spend(amount + fee);
        emit ContactPaid(to, amount, fee);
        token.safeTransfer(to, amount);
        if (fee > 0) token.safeTransfer(feeRecipient, fee);
    }

    /// @notice What the passkey can still pay in the current 24-hour window.
    function remainingToday() public view returns (uint256) {
        if (block.timestamp >= windowStart + WINDOW) return dailyLimit;
        return dailyLimit > spentInWindow ? dailyLimit - spentInWindow : 0;
    }

    // ------------------------------------------------------------------ rulebook (MPC key only)

    function setRulebook(bytes32 root, uint256 limit) external onlyEntryPointOrSelf {
        _setRulebook(root, limit);
    }

    function revokeContact(address contact) external onlyEntryPointOrSelf {
        revoked[contact] = true;
        emit ContactRevoked(contact);
    }

    function setFrozen(bool frozen_) external onlyEntryPointOrSelf {
        frozen = frozen_;
        emit FrozenSet(frozen_);
    }

    /// @notice After a recovery, the new phone's passkey replaces the lost one.
    function setPasskey(bytes32 x, bytes32 y) external onlyEntryPointOrSelf {
        _setPasskey(x, y);
    }

    // ------------------------------------------------------------------ validation

    /**
     * @dev The MPC key may sign any operation. The passkey's operations must be a {payContact} to an
     * approved, non-revoked contact while not frozen; the daily limit is enforced at execution, so that
     * validation does not depend on the block time (ERC-7562).
     */
    function _validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        bytes calldata signature
    ) internal view override returns (uint256) {
        if (signature.length == 0) return ERC4337Utils.SIG_VALIDATION_FAILED;
        uint8 keyType = uint8(signature[0]);

        if (keyType == MPC_KEY) {
            return _isMpcSignature(userOpHash, signature[1:]) ? ERC4337Utils.SIG_VALIDATION_SUCCESS : ERC4337Utils.SIG_VALIDATION_FAILED;
        }
        if (keyType == PASSKEY && _isPasskeySignature(userOpHash, signature[1:]) && _isDailyPayment(userOp.callData)) {
            return ERC4337Utils.SIG_VALIDATION_SUCCESS;
        }
        return ERC4337Utils.SIG_VALIDATION_FAILED;
    }

    function _isDailyPayment(bytes calldata callData) internal view returns (bool) {
        if (callData.length < 4 || bytes4(callData[:4]) != this.payContact.selector) return false;
        (address to, , bytes32[] memory proof, ) = abi.decode(callData[4:], (address, uint256, bytes32[], uint256));
        return _isPayable(to, proof);
    }

    function _isPayable(address to, bytes32[] memory proof) internal view returns (bool) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(to)))); // StandardMerkleTree leaf
        return !frozen && !revoked[to] && MerkleProof.verify(proof, contactsRoot, leaf);
    }

    function _isMpcSignature(bytes32 hash, bytes calldata signature) internal view returns (bool) {
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecoverCalldata(hash, signature);
        return err == ECDSA.RecoverError.NoError && recovered == mpcSigner;
    }

    function _isPasskeySignature(bytes32 hash, bytes calldata signature) internal view returns (bool) {
        (bool decoded, WebAuthn.WebAuthnAuth calldata auth) = WebAuthn.tryDecodeAuth(signature);
        return decoded && WebAuthn.verify(abi.encodePacked(hash), auth, passkeyX, passkeyY, true);
    }

    /// @dev Used by OpenZeppelin's signer plumbing: only the MPC key speaks for the account off-chain.
    function _rawSignatureValidation(bytes32 hash, bytes calldata signature) internal view override returns (bool) {
        return signature.length > 0 && uint8(signature[0]) == MPC_KEY && _isMpcSignature(hash, signature[1:]);
    }

    /// @notice ERC-1271: the ownership proof (Travel Rule) is a message signed by the MPC key.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return _rawSignatureValidation(hash, signature) ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    /// @dev The entry point runs batches signed by the MPC key; validation already checked who signed.
    function _erc7821AuthorizedExecutor(address caller, bytes32 mode, bytes calldata executionData) internal view override returns (bool) {
        return caller == address(entryPoint()) || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    // ------------------------------------------------------------------ internals

    function _spend(uint256 amount) internal {
        if (block.timestamp >= windowStart + WINDOW) {
            windowStart = block.timestamp;
            spentInWindow = 0;
        }
        uint256 remaining = remainingToday();
        if (amount > remaining) revert DailyLimitExceeded(remaining);
        spentInWindow += amount;
    }

    function _setRulebook(bytes32 root, uint256 limit) internal {
        contactsRoot = root;
        dailyLimit = limit;
        emit RulebookSet(root, limit);
    }

    function _setPasskey(bytes32 x, bytes32 y) internal {
        passkeyX = x;
        passkeyY = y;
        emit PasskeySet(x, y);
    }
}
