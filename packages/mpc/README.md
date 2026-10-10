# @sqw/mpc

2-of-3 threshold ECDSA (secp256k1) for the Swissquote Wallet, one key for Bitcoin and Ethereum.

- **Library:** [Silence Laboratories DKLs23](https://github.com/silence-laboratories/dkls23)
  (`@silencelaboratories/dkls-wasm-ll-node` 1.2.0; `-web` for the browser). Audited by Trail of Bits
  (key generation, signing, refresh); also used in BitGo's MIT-licensed SDK (`@bitgo/sdk-lib-mpc`).
- **This package** only routes the library's protocol messages and encodes signatures with
  `@noble/curves` (low-S for Bitcoin, recovery bit for Ethereum). No cryptography of our own.

| Entry point | Runs in | What it gives |
|---|---|---|
| `@sqw/mpc` | browser and Node | `KeygenParty` (one party, serializable between rounds), `coordinateKeygen`, remote/local party handles, NaCl sealing, signature encoding |
| `@sqw/mpc/server` | services | Express routes `/mpc/identity`, `/mpc/keygen`, `/mpc/keygen/:session/rounds/:n`, SQLite store |
| `@sqw/mpc/node` | tests, spike | In-process `keygen()`, `sign([a, b], digest)`, `refresh(shares)`, `recoverLostShare(remaining, lostId)` |

Party ids: `0` phone, `1` Swissquote co-signer, `2` recovery provider. The phone coordinates the rounds.
Messages between the two services are sealed with NaCl `box` (tweetnacl); each service fetches the other's
public key directly, so the phone relays them without being able to read or forge them.

Old shares still combine with *other old shares* after a refresh, so every holder must delete its
previous share once a refresh or recovery completes. The services enforce this from M2 on.

## License notice

`@silencelaboratories/dkls-wasm-ll-node` is licensed under the Silence Laboratories License Agreement,
Copyright © Silence Laboratories Pte. Ltd. All Rights Reserved. The full license, its conditions and
disclaimer are in [`LICENSE-SILENCE-LABORATORIES.md`](LICENSE-SILENCE-LABORATORIES.md).

We use the library unmodified, independently and without any involvement from Silence Laboratories.
The license allows **non-commercial use only** (research, education, personal projects): fine for this
hackathon prototype, but a production launch by Swissquote would need a commercial license.
