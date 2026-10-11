// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAppAdapter} from "./IAppAdapter.sol";

/// @dev The two Aave v3 Pool functions this adapter uses.
interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

/**
 * @title AaveAdapter
 * @notice Deposits one asset into Aave v3 to earn interest, and withdraws it. Deposits are always made on
 * behalf of the account, and withdrawals always go back to it.
 *
 * params = abi.encode(Action action, uint256 amount)   (withdraw type(uint256).max to take everything out)
 */
contract AaveAdapter is IAppAdapter {
    enum Action {
        Supply,
        Withdraw
    }

    IAavePool public immutable pool;
    address public immutable asset;

    constructor(IAavePool pool_, address asset_) {
        pool = pool_;
        asset = asset_;
    }

    function plan(address account, bytes calldata params) external view returns (Execution[] memory calls) {
        (Action action, uint256 amount) = abi.decode(params, (Action, uint256));
        if (action == Action.Supply) {
            calls = new Execution[](3);
            calls[0] = Execution(asset, 0, abi.encodeCall(IERC20.approve, (address(pool), amount)));
            calls[1] = Execution(address(pool), 0, abi.encodeCall(IAavePool.supply, (asset, amount, account, 0)));
            calls[2] = Execution(asset, 0, abi.encodeCall(IERC20.approve, (address(pool), 0)));
        } else {
            calls = new Execution[](1);
            calls[0] = Execution(address(pool), 0, abi.encodeCall(IAavePool.withdraw, (asset, amount, account)));
        }
    }
}
