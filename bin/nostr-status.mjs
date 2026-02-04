#!/usr/bin/env node
/**
 * nostr-status.mjs - Check my Nostr status
 */

import { SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(join(__dirname, '../.credentials/nostr.json')));

const pool = new SimplePool();
const relays = ['wss://relay.damus.io', 'wss://nos.lol'];

console.log(`🌊 Kai's Nostr Status`);
console.log(`📍 npub: ${creds.npub}`);
console.log(`🔑 pubkey: ${creds.publicKeyHex.substring(0, 16)}...`);
console.log('');

// Fetch my events
const events = await pool.querySync(relays, {
  kinds: [0, 1],
  authors: [creds.publicKeyHex],
  limit: 20
});

const profile = events.find(e => e.kind === 0);
const notes = events.filter(e => e.kind === 1);

if (profile) {
  const p = JSON.parse(profile.content);
  console.log(`👤 Profile: ${p.display_name || p.name}`);
  console.log(`   ${p.about?.substring(0, 60)}...`);
}

console.log(`📝 Notes: ${notes.length}`);
notes.slice(0, 5).forEach((n, i) => {
  const time = new Date(n.created_at * 1000).toLocaleTimeString();
  console.log(`   ${i+1}. [${time}] ${n.content.substring(0, 50)}...`);
});

// Check for mentions
const mentions = await pool.querySync(relays, {
  kinds: [1],
  '#p': [creds.publicKeyHex],
  limit: 10
});
const realMentions = mentions.filter(e => e.pubkey !== creds.publicKeyHex);
console.log(`\n💬 Mentions: ${realMentions.length}`);

pool.close(relays);
