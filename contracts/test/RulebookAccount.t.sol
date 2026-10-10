// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC7579Utils, Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/draft-ERC4337Utils.sol";
import {IEntryPoint, PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {RulebookAccount} from "../src/RulebookAccount.sol";
import {RulebookAccountFactory} from "../src/RulebookAccountFactory.sol";
import {SwissquotePaymaster} from "../src/SwissquotePaymaster.sol";

contract TestUSDC is ERC20("Test USDC", "USDC") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RulebookAccountTest is Test {
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant MPC_PK = 0xA11CE;
    uint256 internal constant PASSKEY_PK = 0xFACE1D;
    uint256 internal constant SWISSQUOTE_PK = 0x5E0;
    uint256 internal constant USDC = 1e6;

    address internal leo = makeAddr("leo");
    address internal adam = makeAddr("adam");
    address internal thief = makeAddr("thief");
    address internal swissquote = vm.addr(SWISSQUOTE_PK);

    TestUSDC internal usdc;
    RulebookAccountFactory internal factory;
    RulebookAccount internal account;
    address internal entryPoint;
    bytes32 internal passkeyX;
    bytes32 internal passkeyY;

    function setUp() public {
        usdc = new TestUSDC();
        factory = new RulebookAccountFactory(new RulebookAccount(usdc, swissquote));
        (uint256 x, uint256 y) = vm.publicKeyP256(PASSKEY_PK);
        (passkeyX, passkeyY) = (bytes32(x), bytes32(y));
        account = factory.createAccount(vm.addr(MPC_PK), passkeyX, passkeyY, _root(), 100 * USDC);
        entryPoint = address(account.entryPoint());
        usdc.mint(address(account), 1_000 * USDC);
    }

    // ------------------------------------------------------------------ helpers

    function _leaf(address a) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a))));
    }

    /// Two approved contacts, Léo and Adam (OpenZeppelin StandardMerkleTree: sorted pair).
    function _root() internal view returns (bytes32) {
        (bytes32 a, bytes32 b) = (_leaf(leo), _leaf(adam));
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _proof(address contact) internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = _leaf(contact == leo ? adam : leo);
    }

    function _pay(address to, uint256 amount) internal view returns (bytes memory) {
        return abi.encodeCall(RulebookAccount.payContact, (to, amount, _proof(to), 0));
    }

    function _op(bytes memory callData, bytes memory signature) internal view returns (PackedUserOperation memory op) {
        op.sender = address(account);
        op.callData = callData;
        op.signature = signature;
    }

    /// A WebAuthn assertion of the wallet passkey over `hash`, as a browser would produce it.
    function _passkeySign(uint256 privateKey, bytes32 hash) internal pure returns (bytes memory) {
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(hash)),
            '","origin":"http://localhost:3000","crossOrigin":false}'
        );
        bytes memory authenticatorData = abi.encodePacked(keccak256("localhost"), bytes1(0x05), uint32(1)); // UP + UV
        bytes32 digest = sha256(abi.encodePacked(authenticatorData, sha256(bytes(clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(privateKey, digest);
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s)); // low-S, as the app does
        // OpenZeppelin's WebAuthn.tryDecodeAuth reads the fields encoded flat, not as one tuple.
        return abi.encodePacked(uint8(0x01), abi.encode(r, s, uint256(23), uint256(1), authenticatorData, clientDataJSON));
    }

    function _mpcSign(uint256 privateKey, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, hash);
        return abi.encodePacked(uint8(0x00), r, s, v);
    }

    function _validate(bytes memory callData, bytes memory signature, bytes32 hash) internal returns (uint256) {
        vm.prank(entryPoint);
        return account.validateUserOp(_op(callData, signature), hash, 0);
    }

    function _execute(bytes memory callData) internal {
        vm.prank(entryPoint);
        (bool ok, bytes memory ret) = address(account).call(callData);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function _batch(address target, bytes memory data) internal pure returns (bytes memory) {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(target, 0, data);
        bytes32 mode = bytes32(abi.encodePacked(ERC7579Utils.CALLTYPE_BATCH, ERC7579Utils.EXECTYPE_DEFAULT, bytes30(0)));
        return abi.encodeWithSignature("execute(bytes32,bytes)", mode, abi.encode(calls));
    }

    // ------------------------------------------------------------------ daily payments with Face ID

    function test_PasskeyPaysAnApprovedContactWithinTheLimit() public {
        bytes32 hash = keccak256("pay leo 40");
        assertEq(_validate(_pay(leo, 40 * USDC), _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_SUCCESS);
        _execute(_pay(leo, 40 * USDC));
        assertEq(usdc.balanceOf(leo), 40 * USDC);
        assertEq(account.remainingToday(), 60 * USDC);
    }

    function test_PasskeyCannotPaySomeoneWhoIsNotAContact() public {
        bytes32 hash = keccak256("pay thief");
        bytes memory callData = abi.encodeCall(RulebookAccount.payContact, (thief, 10 * USDC, _proof(leo), 0));
        assertEq(_validate(callData, _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);
        vm.expectRevert(RulebookAccount.OutsideRulebook.selector);
        _execute(callData);
    }

    function test_DailyLimitIsEnforcedAndResetsAfter24Hours() public {
        _execute(_pay(leo, 60 * USDC));
        vm.expectRevert(abi.encodeWithSelector(RulebookAccount.DailyLimitExceeded.selector, 40 * USDC));
        _execute(_pay(adam, 50 * USDC));

        vm.warp(block.timestamp + 1 days);
        _execute(_pay(adam, 50 * USDC));
        assertEq(usdc.balanceOf(adam), 50 * USDC);
    }

    function test_PasskeyCannotChangeTheRulebookOrRunOtherCalls() public {
        bytes32 hash = keccak256("rulebook");
        bytes memory raise = abi.encodeCall(RulebookAccount.setRulebook, (_root(), 1_000_000 * USDC));
        assertEq(_validate(raise, _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);

        bytes memory drain = _batch(address(usdc), abi.encodeCall(usdc.transfer, (thief, 1_000 * USDC)));
        assertEq(_validate(drain, _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);

        bytes memory newPasskey = abi.encodeCall(RulebookAccount.setPasskey, (bytes32(uint256(1)), bytes32(uint256(2))));
        assertEq(_validate(newPasskey, _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);
    }

    function test_PasskeySignatureForAnotherOperationIsRejected() public {
        bytes memory signedForOther = _passkeySign(PASSKEY_PK, keccak256("other operation"));
        assertEq(_validate(_pay(leo, 10 * USDC), signedForOther, keccak256("this operation")), ERC4337Utils.SIG_VALIDATION_FAILED);
    }

    function test_AStolenOrDifferentPasskeyIsRejected() public {
        bytes32 hash = keccak256("pay leo");
        assertEq(_validate(_pay(leo, 10 * USDC), _passkeySign(0xBAD, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);
    }

    function test_RemovedContactCannotBePaidEvenWithAValidProof() public {
        _execute(abi.encodeCall(RulebookAccount.revokeContact, (leo)));
        bytes32 hash = keccak256("pay leo");
        assertEq(_validate(_pay(leo, 10 * USDC), _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);
    }

    function test_FreezingStopsAllPasskeyPayments() public {
        _execute(abi.encodeCall(RulebookAccount.setFrozen, (true)));
        bytes32 hash = keccak256("pay leo");
        assertEq(_validate(_pay(leo, 10 * USDC), _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);
    }

    function test_StandardPlanFeeGoesToSwissquote() public {
        _execute(abi.encodeCall(RulebookAccount.payContact, (leo, 20 * USDC, _proof(leo), USDC / 10)));
        assertEq(usdc.balanceOf(leo), 20 * USDC);
        assertEq(usdc.balanceOf(swissquote), USDC / 10);
    }

    function test_FeesCountTowardsTheDailyLimit() public {
        bytes memory drain = abi.encodeCall(RulebookAccount.payContact, (leo, 1 * USDC, _proof(leo), 500 * USDC));
        vm.expectRevert(abi.encodeWithSelector(RulebookAccount.DailyLimitExceeded.selector, 100 * USDC));
        _execute(drain);
    }

    // ------------------------------------------------------------------ the MPC key

    function test_MpcKeyCanChangeTheRulebookAndRunAnyCall() public {
        bytes32 hash = keccak256("mpc");
        bytes memory raise = abi.encodeCall(RulebookAccount.setRulebook, (_root(), 500 * USDC));
        assertEq(_validate(raise, _mpcSign(MPC_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_SUCCESS);
        _execute(raise);
        assertEq(account.dailyLimit(), 500 * USDC);

        bytes memory transfer = _batch(address(usdc), abi.encodeCall(usdc.transfer, (thief, 5 * USDC)));
        assertEq(_validate(transfer, _mpcSign(MPC_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_SUCCESS);
        _execute(transfer);
        assertEq(usdc.balanceOf(thief), 5 * USDC);
    }

    function test_AnyOtherSecp256k1KeyIsRejected() public {
        bytes32 hash = keccak256("mpc");
        bytes memory raise = abi.encodeCall(RulebookAccount.setRulebook, (_root(), 500 * USDC));
        assertEq(_validate(raise, _mpcSign(SWISSQUOTE_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);
    }

    function test_AfterRecoveryTheNewPasskeyWorksAndTheOldOneNoLonger() public {
        uint256 newPasskey = 0xBEEF;
        (uint256 x, uint256 y) = vm.publicKeyP256(newPasskey);
        _execute(abi.encodeCall(RulebookAccount.setPasskey, (bytes32(x), bytes32(y))));

        bytes32 hash = keccak256("pay leo");
        assertEq(_validate(_pay(leo, 10 * USDC), _passkeySign(newPasskey, hash), hash), ERC4337Utils.SIG_VALIDATION_SUCCESS);
        assertEq(_validate(_pay(leo, 10 * USDC), _passkeySign(PASSKEY_PK, hash), hash), ERC4337Utils.SIG_VALIDATION_FAILED);
    }

    function test_OnlyTheMpcKeySpeaksForTheAccountOffChain() public view {
        bytes32 hash = keccak256("I own this account");
        assertEq(account.isValidSignature(hash, _mpcSign(MPC_PK, hash)), bytes4(0x1626ba7e));
        assertEq(account.isValidSignature(hash, _passkeySign(PASSKEY_PK, hash)), bytes4(0xffffffff));
    }

    function test_OnlyTheEntryPointCanCallTheAccount() public {
        vm.expectRevert();
        account.payContact(leo, 10 * USDC, _proof(leo), 0);
    }

    // ------------------------------------------------------------------ factory

    function test_TheAddressCommitsToEverySettingSoNobodyCanPreCreateIt() public {
        address mpc = vm.addr(MPC_PK);
        assertEq(factory.getAddress(mpc, passkeyX, passkeyY, _root(), 100 * USDC), address(account));
        assertTrue(factory.getAddress(mpc, bytes32(uint256(1)), passkeyY, _root(), 100 * USDC) != address(account));
        assertEq(address(factory.createAccount(mpc, passkeyX, passkeyY, _root(), 100 * USDC)), address(account), "idempotent");

        vm.expectRevert();
        account.initialize(thief, bytes32(0), bytes32(0), bytes32(0), type(uint256).max);
    }

    // ------------------------------------------------------------------ paymaster

    function _sponsored(SwissquotePaymaster paymaster, uint256 signerKey, bytes memory callData) internal view returns (PackedUserOperation memory op) {
        op = _op(callData, "");
        uint48 validUntil = uint48(block.timestamp + 10 minutes);
        op.paymasterAndData = abi.encodePacked(address(paymaster), uint128(100_000), uint128(0), validUntil, uint48(0));
        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(paymaster.getHash(op, validUntil, 0));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        op.paymasterAndData = abi.encodePacked(op.paymasterAndData, r, s, v);
    }

    function test_PaymasterSponsorsOnlyWhatSwissquoteSigned() public {
        SwissquotePaymaster paymaster = new SwissquotePaymaster(IEntryPoint(entryPoint), swissquote);
        PackedUserOperation memory op = _sponsored(paymaster, SWISSQUOTE_PK, _pay(leo, 10 * USDC));

        vm.startPrank(entryPoint);
        (, uint256 validation) = paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
        (address aggregator, ) = ERC4337Utils.getValidationData(validation);
        assertEq(aggregator, address(0), "signed by Swissquote");

        op.callData = _pay(adam, 10 * USDC); // tampered after signing
        (, validation) = paymaster.validatePaymasterUserOp(op, bytes32(0), 0);
        (aggregator, ) = ERC4337Utils.getValidationData(validation);
        assertEq(aggregator, address(1), "tampered operation refused");

        PackedUserOperation memory forged = _sponsored(paymaster, MPC_PK, _pay(leo, 10 * USDC));
        (, validation) = paymaster.validatePaymasterUserOp(forged, bytes32(0), 0);
        (aggregator, ) = ERC4337Utils.getValidationData(validation);
        assertEq(aggregator, address(1), "someone else's signature refused");
        vm.stopPrank();
    }
}
