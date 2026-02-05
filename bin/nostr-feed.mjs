#!/usr/bin/env node
/**
 * nostr-feed.mjs - View posts from followed accounts or specific pubkeys
 * 
 * Usage:
 *   node nostr-feed.mjs                    # Feed from accounts I follow
 *   node nostr-feed.mjs <npub>             # Posts from specific account
 *   node nostr-feed.mjs --search "query"   # Search notes by content
 */

import { Relay } from 'nostr-tools/relay';
import { nip19 } from 'nostr-tools';
import { readFileSync } from 'fs';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

// Load my credentials to get my pubkey
const creds = JSON.parse(readFileSync(new URL('../.credentials/nostr.json', import.meta.url)));
const myPubkey = creds.publicKeyHex;

async function getFollowing(pubkey) {
  // Get kind 3 (contact list) for a pubkey
  for (const url of RELAYS) {
    try {
      const relay = await Relay.connect(url);
      const events = await relay.fetch([{ kinds: [3], authors: [pubkey], limit: 1 }]);
      relay.close();
      if (events.length > 0) {
        // Extract followed pubkeys from tags
        return events[0].tags.filter(t => t[0] === 'p').map(t => t[1]);
      }
    } catch (e) {}
  }
  return [];
}

async function getFeed(pubkeys, limit = 20) {
  const notes = [];
  for (const url of RELAYS) {
    try {
      const relay = await Relay.connect(url);
      const events = await relay.fetch([{ kinds: [1], authors: pubkeys, limit }]);
      relay.close();
      notes.push(...events);
    } catch (e) {}
  }
  // Dedupe and sort by time
  const seen = new Set();
  return notes
    .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

async function getProfile(pubkey) {
  for (const url of RELAYS) {
    try {
      const relay = await Relay.connect(url);
      const events = await relay.fetch([{ kinds: [0], authors: [pubkey], limit: 1 }]);
      relay.close();
      if (events.length > 0) return JSON.parse(events[0].content);
    } catch (e) {}
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  
  let pubkeys = [];
  let label = '';
  
  if (args[0] && args[0].startsWith('npub')) {
    // View specific account
    const { data } = nip19.decode(args[0]);
    pubkeys = [data];
    const profile = await getProfile(data);
    label = profile?.name || args[0].slice(0, 12) + '...';
    console.log(`\n📜 Posts from ${label}\n`);
  } else {
    // View feed from following
    console.log('\n🌊 Fetching who I follow...');
    pubkeys = await getFollowing(myPubkey);
    if (pubkeys.length === 0) {
      console.log('Not following anyone yet!');
      return;
    }
    console.log(`Following ${pubkeys.length} accounts. Fetching feed...\n`);
    label = 'Following';
  }
  
  const notes = await getFeed(pubkeys, 15);
  
  if (notes.length === 0) {
    console.log('No posts found.');
    return;
  }
  
  for (const note of notes) {
    const profile = await getProfile(note.pubkey);
    const name = profile?.name || note.pubkey.slice(0, 8) + '...';
    const time = new Date(note.created_at * 1000).toLocaleString();
    const content = note.content.slice(0, 280) + (note.content.length > 280 ? '...' : '');
    
    console.log(`┌─ ${name} • ${time}`);
    console.log(`│ ${content.split('\n').join('\n│ ')}`);
    console.log(`└─ id: ${note.id.slice(0, 12)}...\n`);
  }
}

main().catch(console.error);
