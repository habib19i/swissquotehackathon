# contracts

Foundry project for the client's digital dollars on Base Sepolia (CLAUDE.md sections 6 and 7, milestone M4).
Built on OpenZeppelin Contracts 5.6.1 (`Account`, ERC-7821, `WebAuthn`/`P256`, `ECDSA`, `MerkleProof`, `Clones`);
no cryptography of our own.

| Contract | Role |
|---|---|
| [`RulebookAccount`](src/RulebookAccount.sol) | The client's ERC-4337 account (EntryPoint v0.9). Two keys: the **wallet passkey** (P-256, WebAuthn) may only call `payContact` (approved contact by Merkle proof, within the daily limit, not frozen); the **2-of-3 MPC key** may do anything, including `setRulebook`, `setFrozen`, `revokeContact` and `setPasskey`. Signatures start with a key-type byte: `0x00` MPC, `0x01` passkey. |
| [`RulebookAccountFactory`](src/RulebookAccountFactory.sol) | Deploys each account as a minimal clone at a deterministic address that commits to every initial setting, so nobody can pre-create a client's account with other keys or rules. |
| [`SwissquotePaymaster`](src/SwissquotePaymaster.sol) | Pays an operation's gas when Swissquote signed for it (verifying-paymaster pattern: the signature covers the whole operation and a validity window). Swissquote decides off-chain: Premium sponsors, Standard requires the USDC fee. |

Merkle leaves are `abi.encode(address)` built with OpenZeppelin's `StandardMerkleTree` (`packages/shared/src/rulebook.ts`).
The daily limit, in USDC units, is tracked in a 24-hour window in contract storage; the Standard-plan fee
counts towards it. Rulebook delays (loosening changes) are enforced by the key holders' services before they
co-sign the on-chain update; see the main README.

Deployed on Base Sepolia and verified on Sourcify: see the main README (M4) and
[`packages/ethereum/src/deployments.ts`](../packages/ethereum/src/deployments.ts).

```bash
pnpm install                                   # OpenZeppelin Contracts from npm
pnpm --filter @sqw/contracts setup             # forge-std into lib/
pnpm --filter @sqw/contracts test              # forge test (17 tests)
pnpm --filter @sqw/contracts build && pnpm --filter @sqw/cosigner deploy:base   # redeploy from Swissquote's wallet
pnpm --filter @sqw/cosigner fund:paymaster     # top up the paymaster's gas deposit
```

Foundry: https://getfoundry.sh (tested with forge 1.8.3).
