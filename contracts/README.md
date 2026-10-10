# contracts

Foundry project for the **rulebook validation module** (CLAUDE.md section 7, milestone M4, workstream 4).

The module must enforce, on Base Sepolia:
- daily payment = wallet passkey signature + Merkle proof that the recipient is an approved contact + amount within the daily limit (tracked per 24h);
- only an MPC signature can call `setRulebook(newRoot, newLimit)`;
- loosening changes take effect after the delay; tightening changes are instant.

Merkle leaves are `abi.encode(address)` built with OpenZeppelin's StandardMerkleTree
(`packages/shared/src/rulebook.ts`), so proofs verify with OpenZeppelin's `MerkleProof`.

Setup: install Foundry (https://book.getfoundry.sh), then `forge install OpenZeppelin/openzeppelin-contracts`.
