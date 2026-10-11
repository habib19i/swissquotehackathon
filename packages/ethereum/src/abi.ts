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
  "function useApp(address adapter, bytes params)",
  "function useAppChecked(address adapter, bytes params)",
  "function setApp(address adapter, bool approved)",
  "function setAppLimit(uint256 limit)",
  "function approvedApp(address adapter) view returns (bool)",
  "function appDailyLimit() view returns (uint256)",
  "function remainingAppToday() view returns (uint256)",
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
  "error AppNotApproved()",
  "error AppDailyLimitExceeded(uint256 remaining)",
  "error UnsafeAppCall()",
]);

export const factoryAbi = parseAbi([
  "function createAccount(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) returns (address)",
  "function getAddress(address mpc, bytes32 x, bytes32 y, bytes32 root, uint256 limit) view returns (address)",
]);

/** The Aave v3 Pool calls a connected app (app.aave.com) may ask for. */
export const aavePoolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);

export const paymasterAbi = parseAbi([
  "function deposit() payable",
  "function signer() view returns (address)",
  "function withdrawTo(address to, uint256 amount)",
]);
