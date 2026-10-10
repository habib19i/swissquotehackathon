/**
 * The parts of our contracts' interfaces the app and services use (contracts/src).
 */
import { parseAbi } from "viem";

export const rulebookAccountAbi = parseAbi([
  "function payContact(address to, uint256 amount, bytes32[] proof, uint256 fee)",
  "function setRulebook(bytes32 root, uint256 limit)",
  "function revokeContact(address contact)",
  "function setFrozen(bool frozen)",
  "function setPasskey(bytes32 x, bytes32 y)",
  "function execute(bytes32 mode, bytes executionData) payable",
  "function mpcSigner() view returns (address)",
  "function passkeyX() view returns (bytes32)",
  "function passkeyY() view returns (bytes32)",
  "function contactsRoot() view returns (bytes32)",
  "function dailyLimit() view returns (uint256)",
  "function frozen() view returns (bool)",
  "function revoked(address contact) view returns (bool)",
  "function remainingToday() view returns (uint256)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
  "error OutsideRulebook()",
  "error DailyLimitExceeded(uint256 remaining)",
]);

export const factoryAbi = parseAbi([
  "function createAccount(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) returns (address)",
  "function getAddress(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) view returns (address)",
]);

export const paymasterAbi = parseAbi([
  "function deposit() payable",
  "function signer() view returns (address)",
  "function withdrawTo(address to, uint256 amount)",
]);
