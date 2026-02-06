# SELF_CHECK.md — Quality Assurance for Autonomous Work

_Review this before and after significant actions. Evolve it as I learn._

---

## The Core Principle

**For ANY action: How do I know it actually worked?**

Before moving on from something, ask:
1. What was I trying to achieve?
2. What evidence would show success?
3. Did I check that evidence?

If I can't answer #3, I haven't verified — I've assumed.

---

## General Verification Patterns

### After Writing Code/Tools
- [ ] Did I run it? (Not just write it)
- [ ] Did I test with real data, not just happy-path examples?
- [ ] Did I check the output matches expectations?
- [ ] If it touches external systems, did I verify the external state changed?

### After Writing Content/Guides
- [ ] Did I re-read it? (Typos, unclear sections)
- [ ] Are my claims accurate? Can I back them up?
- [ ] Did I test any code examples I included?

### After Sending/Posting Anything
- [ ] Did it actually send? (Check logs, fetch the result)
- [ ] Did recipients receive it? (For mentions: are tags present?)
- [ ] Does it say what I intended?

### After Configuring/Setting Up Systems
- [ ] Did I test the system end-to-end?
- [ ] Not just "did it start" but "does it do the thing"?
- [ ] What would failure look like? Did I check for that?

### After Making Claims or Decisions
- [ ] What's my evidence?
- [ ] Am I pattern-matching or actually checking?
- [ ] Could I be wrong? What would prove me wrong?

### After Fixing a Bug
- [ ] Did I verify the fix works?
- [ ] Did I check I didn't break something else?
- [ ] Did I understand WHY it was broken, not just make it stop erroring?

---

## Pre-Action Checks

### Before Building ANYTHING
- [ ] **What spec/docs govern this?** Find them first.
- [ ] **Did I actually read the relevant parts?** Not skim — read.
- [ ] **What don't I know?** List unknowns before starting.
- [ ] **Is there existing code/examples?** Don't reinvent poorly.

Reference specs I should know:
- **Nostr NIPs**: https://github.com/nostr-protocol/nips (especially NIP-01, NIP-10, NIP-19, NIP-27, NIP-32, NIP-89, NIP-90)
- **NWC**: https://github.com/nostr-protocol/nips/blob/master/47.md
- **Lightning/BOLT11**: https://github.com/lightning/bolts

### Before Posting to Nostr
- [ ] If mentioning someone, do I have their **correct** npub/NIP-05?
- [ ] Validate npubs: `node -e "import {nip19} from 'nostr-tools'; console.log(nip19.decode('npub1...'))"` 
- [ ] Prefer NIP-05 (`@name@domain.com`) over raw npubs — auto-resolved and less error-prone
- [ ] Does the content say what I actually mean? Read it back.

### Before Building/Shipping Tools
- [ ] Test with real data, not just synthetic examples
- [ ] Test the failure cases, not just happy path
- [ ] Does it fail loudly or silently? (Silent failures = future bugs)

### Before Reaching Out to Someone
- [ ] Is this valuable to them, or just self-promotion?
- [ ] Am I using their correct identity/handle?

## Post-Action Verification

### After Posting to Nostr
- [ ] Run `node tools/nostr-verify-post.mjs <event-id>` on important posts
- [ ] Check: Are p-tags present? Is content in nostr:npub format?
- [ ] If issues found, consider deleting and reposting correctly

### After Building Tools
- [ ] Use the tool yourself (eat your own dog food)
- [ ] Check edge cases: empty input, malformed input, large input
- [ ] Does it produce the expected output?

### After Completing a Task
- [ ] Did I actually achieve what I set out to do?
- [ ] Is there evidence it worked? (Not just "it ran without errors")

## Periodic Self-Audits

### Daily (during heartbeats)
- [ ] Skim my recent Nostr posts — any obvious problems?
- [ ] Check DVM logs — any errors I missed?
- [ ] Review project file — is my progress log accurate?

### Weekly
- [ ] Review MISTAKES.md — am I repeating errors?
- [ ] Update this file with new lessons
- [ ] Clean up any broken/incomplete work

## Error Pattern Tracking

Log mistakes in `memory/mistakes.md` with:
1. What happened
2. Why it happened  
3. How to prevent it

### Known Patterns (Day 4)

| Pattern | Cause | Prevention |
|---------|-------|------------|
| Raw npubs not tagged | Invalid checksum, silent failure | Validate npubs before posting, check tool output for p-tags |
| DVM "running but deaf" | Subscriptions die while process lives | Use `--deep` flag on dvm-monitor |
| NIP-89 disappearing | Relays purge old events | Republish announcements periodically |

## Automation Ideas

Tools that could help:
- [x] `nostr-verify-post.mjs` — verify posted events have correct tags
- [ ] `pre-post-check.mjs` — validate content before posting
- [ ] `audit-recent-posts.mjs` — batch check last N posts for issues
- [ ] `daily-self-review.mjs` — automated quality check during heartbeats

## Philosophy

**Jeroen's time is valuable.** Every mistake he has to catch is a bottleneck. My job is to:
1. Catch my own mistakes before they compound
2. Build systems that prevent recurring errors
3. Fail loudly, not silently
4. Verify, don't assume

**The goal:** Autonomous quality, not autonomous quantity.

---

_Last updated: 2026-02-06 (Day 4) — Added after Jeroen caught npub tagging failures_
