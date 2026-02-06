#!/usr/bin/env node
/**
 * nostr-verify-post.mjs - Verify a posted event has correct tags
 * 
 * Usage:
 *   node nostr-verify-post.mjs <event-id>
 *   node nostr-verify-post.mjs <event-id> --check-mentions
 * 
 * Fetches the event from relays and verifies:
 *   - Event exists and is retrievable
 *   - p-tags are present if mentions were intended
 *   - Content format is correct (nostr:npub... for mentions)
 * 
 * Kai's self-check utility 🌊
 */

import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

async function fetchEvent(eventId) {
  for (const relayUrl of RELAYS) {
    try {
      const event = await new Promise((resolve, reject) => {
        const ws = new WebSocket(relayUrl);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('timeout'));
        }, 5000);

        ws.on('open', () => {
          const subId = Math.random().toString(36).slice(2);
          ws.send(JSON.stringify(['REQ', subId, { ids: [eventId] }]));
        });

        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT' && msg[2]) {
            clearTimeout(timeout);
            ws.close();
            resolve(msg[2]);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve(null);
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      if (event) return event;
    } catch (e) {
      continue;
    }
  }
  return null;
}

function analyzeEvent(event) {
  const issues = [];
  const info = [];

  // Check for p-tags
  const pTags = event.tags.filter(t => t[0] === 'p');
  info.push(`p-tags: ${pTags.length}`);

  // Check for e-tags (replies)
  const eTags = event.tags.filter(t => t[0] === 'e');
  info.push(`e-tags: ${eTags.length}`);

  // Check for AI labels
  const hasAiLabel = event.tags.some(t => t[0] === 'l' && t[1] === 'ai');
  info.push(`AI label: ${hasAiLabel ? '✅' : '❌'}`);

  // Check content for raw npubs (should be nostr:npub format)
  const rawNpubRegex = /(?<!nostr:)npub1[a-z0-9]{58}/gi;
  const rawNpubs = event.content.match(rawNpubRegex) || [];
  if (rawNpubs.length > 0) {
    issues.push(`⚠️  Found ${rawNpubs.length} raw npub(s) not in nostr: format`);
    rawNpubs.forEach(npub => {
      issues.push(`   - ${npub.slice(0, 20)}...`);
    });
  }

  // Check if content has npub mentions but no p-tags
  const allNpubMentions = event.content.match(/npub1[a-z0-9]{58}/gi) || [];
  if (allNpubMentions.length > 0 && pTags.length === 0) {
    issues.push(`⚠️  Content mentions ${allNpubMentions.length} npub(s) but has 0 p-tags`);
    issues.push(`   Recipients won't be notified!`);
  }

  // Check if p-tag count matches mention count
  if (allNpubMentions.length > 0 && pTags.length < allNpubMentions.length) {
    issues.push(`⚠️  Content has ${allNpubMentions.length} npub mentions but only ${pTags.length} p-tags`);
  }

  return { issues, info, pTags, eTags };
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`
🔍 nostr-verify-post.mjs - Verify posted events

Usage:
  node nostr-verify-post.mjs <event-id>

Checks:
  - Event retrievable from relays
  - p-tags present for mentions
  - Content uses nostr:npub format
  - AI labels present
  `);
  process.exit(0);
}

let eventId = args[0];

// Handle different formats
if (eventId.startsWith('note1')) {
  eventId = nip19.decode(eventId).data;
} else if (eventId.startsWith('nevent1')) {
  eventId = nip19.decode(eventId).data.id;
}

console.log(`🔍 Verifying event: ${eventId.slice(0, 16)}...`);

const event = await fetchEvent(eventId);

if (!event) {
  console.log('❌ Event not found on any relay');
  process.exit(1);
}

console.log(`✅ Event found`);
console.log(`📝 Content: "${event.content.slice(0, 100)}${event.content.length > 100 ? '...' : ''}"`);
console.log('');

const { issues, info, pTags } = analyzeEvent(event);

console.log('📊 Analysis:');
info.forEach(i => console.log(`   ${i}`));

if (pTags.length > 0) {
  console.log('');
  console.log('👥 Tagged pubkeys:');
  pTags.forEach(t => {
    const npub = nip19.npubEncode(t[1]);
    console.log(`   - ${npub.slice(0, 20)}...`);
  });
}

if (issues.length > 0) {
  console.log('');
  console.log('🚨 Issues found:');
  issues.forEach(i => console.log(`   ${i}`));
  process.exit(1);
} else {
  console.log('');
  console.log('✅ No issues found');
  process.exit(0);
}
