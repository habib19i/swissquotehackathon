// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {RulebookAccount} from "./RulebookAccount.sol";

/**
 * @title RulebookAccountFactory
 * @notice Deploys each client's {RulebookAccount} as a minimal clone at a deterministic address, so the app
 * can show the address before the account exists; it is deployed by the first UserOperation (initCode).
 *
 * The address commits to every initial setting. Nobody can pre-create a client's account with a
 * different passkey or rulebook: different settings give a different address.
 */
contract RulebookAccountFactory {
    RulebookAccount public immutable implementation;

    constructor(RulebookAccount implementation_) {
        implementation = implementation_;
    }

    function createAccount(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) external returns (RulebookAccount) {
        bytes32 salt = _salt(mpc, x, y, root, limit);
        address predicted = Clones.predictDeterministicAddress(address(implementation), salt);
        if (predicted.code.length > 0) return RulebookAccount(payable(predicted));

        RulebookAccount account = RulebookAccount(payable(Clones.cloneDeterministic(address(implementation), salt)));
        account.initialize(mpc, x, y, root, limit);
        return account;
    }

    function getAddress(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) external view returns (address) {
        return Clones.predictDeterministicAddress(address(implementation), _salt(mpc, x, y, root, limit));
    }

    function _salt(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) private pure returns (bytes32) {
        return keccak256(abi.encode(mpc, x, y, root, limit));
    }
}
