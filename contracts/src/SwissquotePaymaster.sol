// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/draft-ERC4337Utils.sol";
import {IEntryPoint, IPaymaster, PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SwissquotePaymaster
 * @notice Pays the network fee (gas) of a client's UserOperation when Swissquote has signed for it, so the
 * client never needs ETH (CLAUDE.md section 7). Swissquote's service decides before signing:
 * Premium plan, it sponsors; Standard plan, it signs only operations that pay it the fee in USDC.
 *
 * paymasterAndData = paymaster (20) | verification gas (16) | post-op gas (16) | validUntil (6) | validAfter (6) | signature (65)
 * (the "verifying paymaster" pattern of the ERC-4337 reference implementation).
 */
contract SwissquotePaymaster is IPaymaster {
    uint256 private constant VALIDITY_OFFSET = 52;
    uint256 private constant SIGNATURE_OFFSET = VALIDITY_OFFSET + 12;

    IEntryPoint public immutable entryPoint;
    /// @notice Swissquote's key: signs sponsorships and manages the deposit.
    address public immutable signer;

    error NotEntryPoint();
    error NotSigner();

    constructor(IEntryPoint entryPoint_, address signer_) {
        entryPoint = entryPoint_;
        signer = signer_;
    }

    /// @notice What Swissquote signs: the whole operation except its signatures, plus a validity window.
    function getHash(PackedUserOperation calldata userOp, uint48 validUntil, uint48 validAfter) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                bytes32(userOp.paymasterAndData[20:VALIDITY_OFFSET]),
                userOp.preVerificationGas,
                userOp.gasFees,
                block.chainid,
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256
    ) external view returns (bytes memory context, uint256 validationData) {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
        bytes calldata data = userOp.paymasterAndData;
        uint48 validUntil = uint48(bytes6(data[VALIDITY_OFFSET:VALIDITY_OFFSET + 6]));
        uint48 validAfter = uint48(bytes6(data[VALIDITY_OFFSET + 6:SIGNATURE_OFFSET]));

        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(getHash(userOp, validUntil, validAfter));
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecoverCalldata(hash, data[SIGNATURE_OFFSET:]);
        bool signed = err == ECDSA.RecoverError.NoError && recovered == signer;
        return ("", ERC4337Utils.packValidationData(signed, validAfter, validUntil));
    }

    /// @dev Nothing to settle after execution: the USDC fee (Standard plan) is part of the operation itself.
    function postOp(PostOpMode, bytes calldata, uint256, uint256) external view {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
    }

    /// @notice Funds the gas this paymaster can sponsor (held by the entry point).
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(address payable to, uint256 amount) external {
        if (msg.sender != signer) revert NotSigner();
        entryPoint.withdrawTo(to, amount);
    }
}
