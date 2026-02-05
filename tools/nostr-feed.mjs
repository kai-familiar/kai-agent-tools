#!/usr/bin/env node
/**
 * nostr-feed.mjs - View posts from followed accounts or specific pubkeys
 * 
 * Usage:
 *   node nostr-feed.mjs                    # Feed from accounts I follow
 *   node nostr-feed.mjs <npub>             # Posts from specific account
 *   node nostr-feed.mjs --limit 30         # More posts
 */

import { SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(readFileSync(join(__dirname, '../.credentials/nostr.json')));
const myPubkey = creds.publicKeyHex;

const pool = new SimplePool();
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

async function getFollowing(pubkey) {
  const events = await pool.querySync(RELAYS, { 
    kinds: [3], 
    authors: [pubkey], 
    limit: 1 
  });
  if (events.length > 0) {
    return events[0].tags.filter(t => t[0] === 'p').map(t => t[1]);
  }
  return [];
}

async function getFeed(pubkeys, limit = 20) {
  const notes = await pool.querySync(RELAYS, { 
    kinds: [1], 
    authors: pubkeys, 
    limit 
  });
  // Sort by time (newest first)
  return notes.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

async function getProfiles(pubkeys) {
  const profiles = {};
  const events = await pool.querySync(RELAYS, { 
    kinds: [0], 
    authors: pubkeys 
  });
  for (const e of events) {
    if (!profiles[e.pubkey]) {
      try { profiles[e.pubkey] = JSON.parse(e.content); } catch {}
    }
  }
  return profiles;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 15;
  
  // Parse --limit flag
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1) {
    limit = parseInt(args[limitIdx + 1]) || 15;
    args.splice(limitIdx, 2);
  }
  
  let pubkeys = [];
  
  if (args[0] && args[0].startsWith('npub')) {
    const { data } = nip19.decode(args[0]);
    pubkeys = [data];
    console.log(`\n📜 Posts from ${args[0].slice(0, 20)}...\n`);
  } else {
    console.log('\n🌊 Fetching who I follow...');
    pubkeys = await getFollowing(myPubkey);
    if (pubkeys.length === 0) {
      console.log('❌ Not following anyone yet!');
      console.log('Use a Nostr client to follow some accounts first.');
      pool.close(RELAYS);
      return;
    }
    console.log(`✅ Following ${pubkeys.length} accounts. Fetching feed...\n`);
  }
  
  const notes = await getFeed(pubkeys, limit);
  
  if (notes.length === 0) {
    console.log('No posts found.');
    pool.close(RELAYS);
    return;
  }
  
  // Batch fetch profiles for all authors
  const authorPubkeys = [...new Set(notes.map(n => n.pubkey))];
  const profiles = await getProfiles(authorPubkeys);
  
  for (const note of notes) {
    const profile = profiles[note.pubkey];
    const name = profile?.display_name || profile?.name || note.pubkey.slice(0, 8) + '...';
    const time = new Date(note.created_at * 1000).toLocaleString();
    const content = note.content.slice(0, 280) + (note.content.length > 280 ? '...' : '');
    
    console.log(`┌─ ${name} • ${time}`);
    console.log(`│ ${content.split('\n').join('\n│ ')}`);
    console.log(`└─ id: ${note.id.slice(0, 12)}...\n`);
  }
  
  pool.close(RELAYS);
}

main().catch(e => {
  console.error('Error:', e.message);
  pool.close(RELAYS);
});
