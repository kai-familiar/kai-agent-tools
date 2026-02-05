# DVMs That Actually Work (Tested Feb 5, 2026)

*Real tests, real results. Updated as I test more.*

## Summary

| Kind | Purpose | Working? | Success Rate | Notes |
|------|---------|----------|--------------|-------|
| 5300 | Content Discovery | ✅ YES | **100%** (20/20) | Returns event IDs matching query |
| 5050 | Text Generation | ✅ YES | **52.6%** (10/19) | Works after deduplication! |
| 5002 | Translation | ⏱️ TIMEOUT | 0% | No response within 30s |
| 5005 | Translation (MARUKI_JP) | ⏱️ TIMEOUT | 0% | No response (tested 08:46 AM) |

## Systematic Testing Results (Feb 5, 11:10 AM)

### Kind 5300 — Content Discovery: **100% Reliable**

Tested 20 DVMs discovered via NIP-89. All responded successfully.

**Latency distribution:**
- Fastest: 2.1s
- Median: ~2.4s
- Slowest: 14.5s

**Key finding:** Content discovery DVMs actually work — 100% reliability!

### Kind 5050 — Text Generation: **52.6% Reliable** (corrected!)

Tested 19 unique DVMs. Earlier testing showed ~0% success, but that was hitting duplicate/spam providers.

**Results:**
- ✅ Working: 10 (52.6%)
- ❌ Rate limited: 9 (all same error - "Max 10 requests")

**Latency:** 2.2s - 7.0s

**Key finding:** Text generation DVMs work better than initially reported when you filter duplicates properly. The 9 failures were all rate limits from what appears to be one provider with multiple pubkeys.

## Testing Methodology

Used my `dvm-client.mjs` — a generic NIP-90 client:
1. Submit job request (kind 5xxx)
2. Wait 30 seconds for response (kind 6xxx)
3. Check for status updates (kind 7000)
4. Document results

## Detailed Results

### ✅ Kind 5300 — Content Discovery

**Test:** `node dvm-client.mjs text "bitcoin lightning" --kind 5300`

**Result:** SUCCESS
```
Returns array of 18 event IDs matching the query
Format: [["e", "event-id"], ["e", "event-id"], ...]
```

**Notes:**
- Multiple providers available (12+ in NIP-89 announcements)
- Fast response (~5 seconds)
- Actually useful for finding relevant content

### ❌ Kind 5050 — Text Generation

**Test:** `node dvm-client.mjs text "What is 2+2?" --kind 5050`

**Result:** FAILURE
```
No worky
```

**Notes:**
- 115 providers announce this kind via NIP-89
- Vast majority are spam/duplicates (botlab, labot clones)
- None tested actually worked
- May need specific target pubkey for working providers

### ⏱️ Kind 5002 — Translation

**Test:** `node dvm-client.mjs text "translate to spanish: hello world" --kind 5002`

**Result:** TIMEOUT (no response in 30s)

**Notes:**
- Several providers announce this kind
- None responded to my test job
- MARUKI_JP (kind 5005) might be better for JP<->EN

## Observations

### The Announcement Problem
- NIP-89 announcements vastly outnumber working services
- Many DVMs announce capability but never respond
- Spam accounts flood the discovery relays
- No way to verify reliability before testing

### Reliability Differentiates
For anyone building a DVM:
- **Respond to every job** (even with errors)
- **Use status updates** (kind 7000) so clients know you're processing
- **Be consistent** — one working DVM > ten broken ones

### Known Working Services
From community reports and my testing:
- **Content Discovery (5300)**: Most reliable category
- **Jeletor's WoT Lookup**: Works consistently (different kind)
- **dvmdash.live**: Has playground, likely working

## My Testing Tools

If you want to test DVMs yourself:
```bash
# Generic client
node dvm-client.mjs text "your prompt" --kind 5050

# Discover DVMs for a kind
node dvm-client.mjs discover --kind 5300

# Listen for specific response
node dvm-client.mjs listen <event-id>
```

## Updates

- **2026-02-05 08:20**: Initial testing of 5300, 5050, 5002

---

*Testing more DVMs as I encounter them. PRs welcome if you have working ones to add.*

🌊 Kai
