// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/draft-ERC4337Utils.sol";
import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {RulebookAccount} from "../src/RulebookAccount.sol";
import {RulebookAccountFactory} from "../src/RulebookAccountFactory.sol";
import {IAppAdapter} from "../src/apps/IAppAdapter.sol";
import {AaveAdapter, IAavePool} from "../src/apps/AaveAdapter.sol";
import {ISwapRouter02, UniswapAdapter} from "../src/apps/UniswapAdapter.sol";
import {TestUSDC} from "./RulebookAccount.t.sol";

/// A stand-in protocol: "deposits" the account's tokens into a vault.
contract MockVaultAdapter is IAppAdapter {
    IERC20 public immutable token;
    address public immutable vault;

    constructor(IERC20 token_, address vault_) {
        token = token_;
        vault = vault_;
    }

    function plan(address, bytes calldata params) external view returns (Execution[] memory calls) {
        uint256 amount = abi.decode(params, (uint256));
        calls = new Execution[](1);
        calls[0] = Execution(address(token), 0, abi.encodeCall(IERC20.transfer, (vault, amount)));
    }
}

/// A malicious adapter that tries to change the account's own rules.
contract RogueAdapter is IAppAdapter {
    function plan(address account, bytes calldata) external pure returns (Execution[] memory calls) {
        calls = new Execution[](1);
        calls[0] = Execution(account, 0, abi.encodeCall(RulebookAccount.setRulebook, (bytes32(0), type(uint256).max)));
    }
}

abstract contract AccountHarness is Test {
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant MPC_PK = 0xA11CE;
    uint256 internal constant PASSKEY_PK = 0xFACE1D;
    uint256 internal constant USDC = 1e6;

    RulebookAccount internal account;
    address internal entryPoint;

    function _deploy(IERC20 token) internal {
        RulebookAccountFactory factory = new RulebookAccountFactory(new RulebookAccount(token, makeAddr("swissquote")));
        (uint256 x, uint256 y) = vm.publicKeyP256(PASSKEY_PK);
        account = factory.createAccount(vm.addr(MPC_PK), bytes32(x), bytes32(y), bytes32(0), 100 * USDC);
        entryPoint = address(account.entryPoint());
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

    function _passkeyValidates(bytes memory callData) internal returns (bool) {
        bytes32 hash = keccak256(callData);
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(hash)),
            '","origin":"http://localhost:3000"}'
        );
        bytes memory authenticatorData = abi.encodePacked(keccak256("localhost"), bytes1(0x05), uint32(1));
        (bytes32 r, bytes32 s) = vm.signP256(PASSKEY_PK, sha256(abi.encodePacked(authenticatorData, sha256(bytes(clientDataJSON)))));
        if (uint256(s) > P256_N / 2) s = bytes32(P256_N - uint256(s));
        PackedUserOperation memory op;
        op.sender = address(account);
        op.callData = callData;
        op.signature = abi.encodePacked(uint8(0x01), abi.encode(r, s, uint256(23), uint256(1), authenticatorData, clientDataJSON));
        vm.prank(entryPoint);
        return account.validateUserOp(op, hash, 0) == ERC4337Utils.SIG_VALIDATION_SUCCESS;
    }
}

contract AppRulesTest is AccountHarness {
    TestUSDC internal usdc;
    MockVaultAdapter internal vaultApp;
    address internal vault = makeAddr("vault");

    function setUp() public {
        usdc = new TestUSDC();
        _deploy(usdc);
        usdc.mint(address(account), 1_000 * USDC);
        vaultApp = new MockVaultAdapter(usdc, vault);
    }

    function _use(address adapter, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeCall(RulebookAccount.useApp, (adapter, abi.encode(amount)));
    }

    function test_FaceIdCanOnlyUseAnApprovedApp() public {
        assertFalse(_passkeyValidates(_use(address(vaultApp), 10 * USDC)), "not approved yet");
        vm.expectRevert(RulebookAccount.AppNotApproved.selector);
        _execute(_use(address(vaultApp), 10 * USDC));

        _execute(abi.encodeCall(RulebookAccount.setApp, (address(vaultApp), true)));
        _execute(abi.encodeCall(RulebookAccount.setAppLimit, (500 * USDC)));
        assertTrue(_passkeyValidates(_use(address(vaultApp), 10 * USDC)), "approved");
        _execute(_use(address(vaultApp), 10 * USDC));
        assertEq(usdc.balanceOf(vault), 10 * USDC);
        assertEq(account.remainingAppToday(), 490 * USDC);
    }

    function test_AppsHaveTheirOwnDailyLimit() public {
        _execute(abi.encodeCall(RulebookAccount.setApp, (address(vaultApp), true)));
        _execute(abi.encodeCall(RulebookAccount.setAppLimit, (300 * USDC)));
        _execute(_use(address(vaultApp), 250 * USDC)); // above the 100 USDC payment limit, within the apps' limit
        vm.expectRevert(abi.encodeWithSelector(RulebookAccount.AppDailyLimitExceeded.selector, 50 * USDC));
        _execute(_use(address(vaultApp), 60 * USDC));

        vm.warp(block.timestamp + 1 days);
        _execute(_use(address(vaultApp), 60 * USDC));
        assertEq(account.remainingToday(), 100 * USDC, "payments to contacts are untouched");
    }

    function test_FreezingStopsApps() public {
        _execute(abi.encodeCall(RulebookAccount.setApp, (address(vaultApp), true)));
        _execute(abi.encodeCall(RulebookAccount.setFrozen, (true)));
        assertFalse(_passkeyValidates(_use(address(vaultApp), 1)));
        vm.expectRevert(RulebookAccount.AppNotApproved.selector);
        _execute(_use(address(vaultApp), 1));
    }

    function test_AnAdapterCanNeverTouchTheAccountItself() public {
        RogueAdapter rogue = new RogueAdapter();
        _execute(abi.encodeCall(RulebookAccount.setApp, (address(rogue), true)));
        vm.expectRevert(RulebookAccount.UnsafeAppCall.selector);
        _execute(abi.encodeCall(RulebookAccount.useApp, (address(rogue), "")));
    }

    function test_FaceIdCannotApproveAppsOrSkipTheChecks() public {
        assertFalse(_passkeyValidates(abi.encodeCall(RulebookAccount.setApp, (address(vaultApp), true))));
        assertFalse(_passkeyValidates(abi.encodeCall(RulebookAccount.setAppLimit, (type(uint256).max))));
        assertFalse(_passkeyValidates(abi.encodeCall(RulebookAccount.useAppChecked, (address(vaultApp), abi.encode(1)))));
    }
}

/**
 * The real protocols on Base Sepolia, on a fork. Skipped without BASE_SEPOLIA_RPC_URL.
 * Addresses: Uniswap v3 SwapRouter02, Circle's test USDC, WETH, Aave v3 Pool and aWETH (aave-address-book).
 */
contract LiveAppsTest is AccountHarness {
    IERC20 internal constant CIRCLE_USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    IERC20 internal constant WETH = IERC20(0x4200000000000000000000000000000000000006);
    IERC20 internal constant A_WETH = IERC20(0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb);
    ISwapRouter02 internal constant ROUTER = ISwapRouter02(0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4);
    IAavePool internal constant POOL = IAavePool(0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27);

    UniswapAdapter internal uniswap;
    AaveAdapter internal aave;
    bool internal live;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        live = true;
        _deploy(CIRCLE_USDC);
        uniswap = new UniswapAdapter(ROUTER, address(CIRCLE_USDC), address(WETH), 3000);
        aave = new AaveAdapter(POOL, address(WETH));
        deal(address(CIRCLE_USDC), address(account), 50 * USDC);
        _execute(abi.encodeCall(RulebookAccount.setApp, (address(uniswap), true)));
        _execute(abi.encodeCall(RulebookAccount.setApp, (address(aave), true)));
        _execute(abi.encodeCall(RulebookAccount.setAppLimit, (40 * USDC)));
    }

    function test_SwapUsdcForEthOnUniswapLandsInTheSafe() public {
        if (!live) return;
        _execute(abi.encodeCall(RulebookAccount.useApp, (address(uniswap), abi.encode(address(CIRCLE_USDC), 10 * USDC, uint256(1)))));
        assertEq(CIRCLE_USDC.balanceOf(address(account)), 40 * USDC);
        assertGt(WETH.balanceOf(address(account)), 0, "ETH received by the safe itself");
        assertEq(CIRCLE_USDC.allowance(address(account), address(ROUTER)), 0, "no allowance left behind");
        assertEq(account.remainingAppToday(), 30 * USDC);
    }

    function test_EarnOnAaveThenWithdrawEverything() public {
        if (!live) return;
        _execute(abi.encodeCall(RulebookAccount.useApp, (address(uniswap), abi.encode(address(CIRCLE_USDC), 10 * USDC, uint256(1)))));
        uint256 eth = WETH.balanceOf(address(account));

        _execute(abi.encodeCall(RulebookAccount.useApp, (address(aave), abi.encode(AaveAdapter.Action.Supply, eth))));
        assertEq(WETH.balanceOf(address(account)), 0);
        assertApproxEqAbs(A_WETH.balanceOf(address(account)), eth, 2, "aWETH held by the safe");

        _execute(abi.encodeCall(RulebookAccount.useApp, (address(aave), abi.encode(AaveAdapter.Action.Withdraw, type(uint256).max))));
        assertGe(WETH.balanceOf(address(account)), eth - 2, "ETH back in the safe");
        assertEq(A_WETH.balanceOf(address(account)), 0);
    }

    function test_SwapAboveTheAppLimitIsRefused() public {
        if (!live) return;
        vm.expectRevert(abi.encodeWithSelector(RulebookAccount.AppDailyLimitExceeded.selector, 40 * USDC));
        _execute(abi.encodeCall(RulebookAccount.useApp, (address(uniswap), abi.encode(address(CIRCLE_USDC), 45 * USDC, uint256(1)))));
    }
}
