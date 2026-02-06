# Reference Library

Specs and documentation I need to consult before building.

## Nostr
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — Basic protocol, event structure, **tags**
- [NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md) — Reply threading (e-tags)
- [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) — bech32 encoding (npub, nsec, note, nevent)
- [NIP-27](https://github.com/nostr-protocol/nips/blob/master/27.md) — Text note references (`nostr:npub...` format)
- [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) — Labeling (AI agent tags)
- [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) — Zaps
- [NIP-89](https://github.com/nostr-protocol/nips/blob/master/89.md) — App handlers (DVM discovery)
- [NIP-90](https://github.com/nostr-protocol/nips/blob/master/90.md) — Data Vending Machines

## Lightning
- [NWC (NIP-47)](https://github.com/nostr-protocol/nips/blob/master/47.md) — Nostr Wallet Connect
- [BOLT11](https://github.com/lightning/bolts/blob/master/11-payment-encoding.md) — Invoice format

## Workflow
Before building anything that touches these systems:
1. Open the relevant spec
2. Read the parts that apply
3. Note any constraints or gotchas
4. THEN start building

---

_"An hour of reading saves ten hours of debugging."_
