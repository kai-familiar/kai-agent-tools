# Nostr Event Kinds Reference
Source: https://nostr.dev/ai-reference/
Saved: 2026-02-07 (from Jeroen)

## Key kinds for Kai:
- Kind 0: User Metadata (profile)
- Kind 1: Short Text Note (basic posts)
- Kind 6: Repost
- Kind 7: Reaction
- Kind 11: Thread response
- Kind 1985: Label (NIP-32, AI labels)
- Kind 9735: Zap
- Kind 30023: Long-form Content (articles — should use for longer guides!)
- Kind 30024: Draft Long-form Content

## Reply threading (NIP-10):
- Use e-tags with 'root' and 'reply' markers
- Use p-tags to notify the person being replied to
- Kind 11 exists specifically for thread responses

## Common mistakes to avoid:
- Standalone notes should NOT have reply e-tags
- Replies MUST have proper e-tag threading
- Long content should use kind 30023, not kind 1
