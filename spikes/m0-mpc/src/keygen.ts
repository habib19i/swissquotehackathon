/** M0 spike step 1: create a 2-of-3 MPC key and print the addresses to fund. */
import { keygen } from "@sqw/mpc/node";
import { hasShares, loadShare, mpcAddresses, saveShares } from "./wallet";

let publicKey: Uint8Array;

if (hasShares() && !process.argv.includes("--force")) {
  publicKey = loadShare("phone").publicKey;
  console.log("Reusing the existing MPC key (pass --force to create a new one).\n");
} else {
  console.log("Running 2-of-3 distributed key generation (DKLs23)...\n");
  const shares = keygen();
  saveShares(shares);
  publicKey = shares[0].publicKey;
}

const a = mpcAddresses(publicKey);
console.log(`MPC public key:          ${a.publicKey}`);
console.log(`Bitcoin signet address:  ${a.savingsSafe}`);
console.log(`Base Sepolia address:    ${a.ethereum}`);
console.log(`
Fund them, then run \`pnpm send-btc\` and \`pnpm send-eth\`:
  signet sBTC:       https://signetfaucet.com  or  https://alt.signetfaucet.com  (0.001 is plenty)
  Base Sepolia ETH:  https://portal.cdp.coinbase.com/products/faucet  (any small amount)`);
