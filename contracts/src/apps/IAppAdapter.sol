// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";

/**
 * @title IAppAdapter
 * @notice A Swissquote-vetted adapter for one DeFi protocol. It only *plans* calls: given the account and
 * the client's request, it returns the exact calls to make, with every output going back to the account.
 * Adapters are immutable and hold no funds; the account executes the calls and enforces its own limits.
 */
interface IAppAdapter {
    function plan(address account, bytes calldata params) external view returns (Execution[] memory calls);
}
