// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAppAdapter} from "./IAppAdapter.sol";

/// @dev Uniswap v3 SwapRouter02 (no deadline field).
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/**
 * @title UniswapAdapter
 * @notice Exchanges one of two tokens for the other in a single Uniswap v3 pool. The recipient is always the
 * account itself, and the router's allowance is set to the exact amount and back to zero in the same operation.
 *
 * params = abi.encode(address tokenIn, uint256 amountIn, uint256 amountOutMinimum)
 */
contract UniswapAdapter is IAppAdapter {
    ISwapRouter02 public immutable router;
    address public immutable tokenA;
    address public immutable tokenB;
    uint24 public immutable fee;

    error UnsupportedToken(address token);

    constructor(ISwapRouter02 router_, address tokenA_, address tokenB_, uint24 fee_) {
        router = router_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        fee = fee_;
    }

    function plan(address account, bytes calldata params) external view returns (Execution[] memory calls) {
        (address tokenIn, uint256 amountIn, uint256 amountOutMinimum) = abi.decode(params, (address, uint256, uint256));
        if (tokenIn != tokenA && tokenIn != tokenB) revert UnsupportedToken(tokenIn);
        address tokenOut = tokenIn == tokenA ? tokenB : tokenA;

        ISwapRouter02.ExactInputSingleParams memory swap = ISwapRouter02.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: account,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });
        calls = new Execution[](3);
        calls[0] = Execution(tokenIn, 0, abi.encodeCall(IERC20.approve, (address(router), amountIn)));
        calls[1] = Execution(address(router), 0, abi.encodeCall(ISwapRouter02.exactInputSingle, (swap)));
        calls[2] = Execution(tokenIn, 0, abi.encodeCall(IERC20.approve, (address(router), 0)));
    }
}
