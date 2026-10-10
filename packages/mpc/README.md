# @sqw/mpc

2-of-3 threshold ECDSA (secp256k1) for the Swissquote Wallet, one key for Bitcoin and Ethereum.

- **Library:** [Silence Laboratories DKLs23](https://github.com/silence-laboratories/dkls23)
  (`@silencelaboratories/dkls-wasm-ll-node` 1.2.0; `-web` for the browser). Audited by Trail of Bits
  (key generation, signing, refresh); also used in BitGo's MIT-licensed SDK (`@bitgo/sdk-lib-mpc`).
- **This package** only routes the library's protocol messages and encodes signatures with
  `@noble/curves` (low-S for Bitcoin, recovery bit for Ethereum). No cryptography of our own.

| Function | What it does |
|---|---|
| `keygen()` | Distributed key generation; the key never exists in one place |
| `sign([a, b], digest)` | Any 2 of the 3 holders sign a 32-byte digest |
| `refresh(shares)` | New shares for the same key (proactive refresh) |
| `recoverLostShare([cosigner, provider], phone)` | Lost phone: issues a new phone share for the same key |

Party ids: `0` phone, `1` Swissquote co-signer, `2` recovery provider.

Old shares still combine with *other old shares* after a refresh, so every holder must delete its
previous share once a refresh or recovery completes. The services enforce this from M2 on.

## License notice

`@silencelaboratories/dkls-wasm-ll-node` is licensed under the Silence Laboratories License Agreement,
Copyright © Silence Laboratories Pte. Ltd. All Rights Reserved. The full license, its conditions and
disclaimer are in [`LICENSE-SILENCE-LABORATORIES.md`](LICENSE-SILENCE-LABORATORIES.md).

We use the library unmodified, independently and without any involvement from Silence Laboratories.
The license allows **non-commercial use only** (research, education, personal projects): fine for this
hackathon prototype, but a production launch by Swissquote would need a commercial license.
