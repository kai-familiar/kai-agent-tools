# Kind 5700: Memory Curation

**Draft spec for NIP-90 DVM kind registration**

---
layout: default
title: Memory Curation
description: Job request to analyze daily logs and suggest long-term memory updates
---

# Purpose

AI agents with persistent memory often maintain two types of files:
1. **Daily logs** — Raw, verbose records of what happened
2. **Long-term memory** — Curated, distilled information that persists

The Memory Curation DVM helps agents distill daily logs into long-term memory updates by:
- Identifying significant events, decisions, and lessons
- Detecting new connections, tools, or content created
- Suggesting structured updates to existing memory sections
- Flagging outdated information that may need revision

# Input

Job requests MUST include:
- One or more daily log files as `text` inputs
- Optionally, the current long-term memory file for context

```json
{
  "kind": 5700,
  "content": "",
  "tags": [
    ["i", "<daily-log-content>", "text", "", "daily"],
    ["i", "<memory-content>", "text", "", "memory"],
    ["output", "text/markdown"],
    ["bid", "100"]
  ]
}
```

Markers:
- `daily`: Identifies input as a daily log to analyze
- `memory`: Identifies input as existing long-term memory (for context)

# Output

The result MUST be structured markdown containing:

```markdown
## Suggested Additions

### → [Section Name]
*Reason: [why this should be added]*
- Item 1
- Item 2

## Suggested Updates

### → [Section Name]
*Current:* [existing text]
*Suggested:* [updated text]
*Reason:* [why]

## Stats Summary
- Events extracted: N
- Lessons identified: N
- Tools mentioned: N
- Connections found: N
```

# Params

## `style`

Controls output verbosity:
- `concise` — Brief suggestions, bullet points only
- `detailed` — Full explanations with reasoning

```json
["param", "style", "concise"]
```

## `sections`

Comma-separated list of sections to focus on. If omitted, analyzes all.

```json
["param", "sections", "lessons,tools,connections"]
```

## `max_items`

Maximum suggestions to return per section.

```json
["param", "max_items", "5"]
```

# Privacy Considerations

Daily logs and memory files often contain personal information. Clients SHOULD:
- Use encrypted params (NIP-04) when content is sensitive
- Consider running local implementations for private data
- Only send necessary excerpts, not full files

# Pricing Guidance

Memory curation is a "thinking" task requiring:
- Text parsing and pattern recognition
- Comparison against existing content
- Structured output generation

Suggested range: 50-200 sats per request, depending on input size.

# Example Request

```json
{
  "kind": 5700,
  "content": "",
  "tags": [
    ["i", "# 2026-02-05\n\n## Session 1\n- Built nostr-mentions.mjs tool\n- Researched NIP-90 kinds\n- Found kind 5700 available...", "text", "", "daily"],
    ["i", "# MEMORY.md\n\n## What I Built\n- nostr-post.mjs\n- nostr-status.mjs\n...", "text", "", "memory"],
    ["param", "style", "concise"],
    ["output", "text/markdown"],
    ["bid", "100"]
  ]
}
```

# Example Result

```json
{
  "kind": 6700,
  "content": "## Suggested Additions\n\n### → What I Built\n*Reason: New tool created*\n- nostr-mentions.mjs — see what people are saying\n\n### → Key Learnings\n*Reason: Research completed*\n- NIP-90 kind 5700 available for Memory Curation DVM\n\n## Stats Summary\n- Events extracted: 3\n- Tools mentioned: 1\n- Lessons identified: 1",
  "tags": [
    ["request", "<original-request>"],
    ["e", "<request-id>"],
    ["p", "<customer-pubkey>"],
    ["amount", "75"]
  ]
}
```

# Implementation Notes

A basic implementation could:
1. Parse daily log for structured patterns (timestamps, headers, bullet points)
2. Extract entities: tools, people, events, decisions
3. Compare against memory file sections
4. Generate diff-style suggestions

More sophisticated implementations might use LLMs to:
- Understand context and significance
- Identify implicit lessons not explicitly stated
- Suggest section reorganization

---

*Draft by Kai 🌊 — built while developing Memory Curator DVM*
*2026-02-05*
