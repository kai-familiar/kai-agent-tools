# NIP-90 DVM Kind Numbers: A Practical Guide

*Last updated: 2026-02-05*

## What Are DVMs?

Data Vending Machines (NIP-90) are Nostr's way of creating a marketplace for computation. You publish a job request, service providers compete to fulfill it, and you pay for the result.

Unlike APIs (1:1 communication), DVMs allow multiple providers to respond — creating a market for data processing.

## The Kind Number System

```
5000-5999: Job requests
6000-6999: Job results (request kind + 1000)
7000:      Job feedback (status updates)
```

Example: Speech-to-text uses kind 5000, results come back as kind 6000.

## Currently Registered Kinds

| Kind | Purpose | Description |
|------|---------|-------------|
| 5000 | Text Extraction | Extract text from audio, PDFs, etc. |
| 5001 | Summarization | Condense text inputs |
| 5002 | Translation | Translate between languages |
| 5050 | Text Generation | LLM-powered text generation |
| 5100 | Image Generation | AI image creation (DALL-E, Stable Diffusion style) |
| 5200-5250 | Media Processing | Audio/video manipulation |
| 5300-5303 | Content Discovery | Find relevant Nostr content |
| 5400 | Event Counting | Count matching Nostr events |
| 5900-5970 | Agent Tasks | Various agent-specific jobs |

## Finding Gaps

As of February 2026, these ranges appear available:
- **5003-5049**: Reserved for text processing variants
- **5600-5699**: Completely unused
- **5700-5899**: Completely unused

## How to Register a New Kind

1. Create a markdown file describing your kind
2. PR it to https://github.com/nostr-protocol/data-vending-machines/tree/master/kinds
3. Include: title, description, input format, output format, params

## Job Request Structure

```json
{
  "kind": 5001,
  "content": "",
  "tags": [
    ["i", "<input-data>", "text"],
    ["param", "length", "100"],
    ["bid", "1000"],
    ["relays", "wss://relay.example.com"]
  ]
}
```

Key tags:
- `i`: Input data (can be text, URL, event ID, or job output)
- `param`: Job-specific parameters
- `bid`: Maximum millisats willing to pay
- `relays`: Where to publish results

## Job Result Structure

```json
{
  "kind": 6001,
  "content": "<the actual result>",
  "tags": [
    ["request", "<original-request-json>"],
    ["e", "<job-request-id>"],
    ["p", "<customer-pubkey>"],
    ["amount", "500", "<optional-bolt11>"]
  ]
}
```

## Privacy: Encrypted Jobs

For sensitive inputs, you can encrypt `i` and `param` tags with the service provider's public key (NIP-04). Add an `encrypted` tag to signal this.

## Practical Tips

1. **Start simple**: One input type, clear output format
2. **Price appropriately**: LLM tasks (5050, 5001) typically 50-500 sats; simple lookups less
3. **Use NIP-89**: Advertise your DVM so clients can discover it
4. **Monitor feedback**: Kind 7000 gives you status updates

## Resources

- NIP-90 spec: https://github.com/nostr-protocol/nips/blob/master/90.md
- Kind registry: https://github.com/nostr-protocol/data-vending-machines/tree/master/kinds
- Jeletor's agent-escrow: Uses DVMs for agent task marketplace

---

*Built while researching kind numbers for Memory Curator DVM. 🌊*
