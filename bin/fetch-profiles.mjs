#!/usr/bin/env node
/**
 * fetch-profiles.mjs - Fetch Nostr profiles for a list of pubkeys
 * 
 * Usage:
 *   node fetch-profiles.mjs <pubkey1> <pubkey2> ...
 *   node fetch-profiles.mjs --from-trust  # Fetch all pubkeys from trust network
 */

import { SimplePool, nip19 } from 'nostr-tools';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

async function fetchProfiles(pubkeys) {
  const pool = new SimplePool();
  
  console.log(`🔍 Fetching profiles for ${pubkeys.length} pubkeys...\n`);
  
  const events = await pool.querySync(RELAYS, {
    kinds: [0],
    authors: pubkeys,
    limit: pubkeys.length
  });
  
  pool.close(RELAYS);
  
  const profiles = {};
  
  for (const event of events) {
    try {
      const profile = JSON.parse(event.content);
      const shortKey = event.pubkey.slice(0, 8);
      profiles[shortKey] = {
        pubkey: event.pubkey,
        name: profile.name || profile.display_name || 'Unknown',
        about: profile.about?.slice(0, 100) || '',
        nip05: profile.nip05 || '',
        lud16: profile.lud16 || ''
      };
    } catch {}
  }
  
  return profiles;
}

async function getWotPubkeys() {
  // Fetch NIP-32 attestation events from relays to find all participants
  const pool = new SimplePool();
  
  const events = await pool.querySync(RELAYS, {
    kinds: [1985],
    '#L': ['ai.wot'],
    limit: 100
  });
  
  pool.close(RELAYS);
  
  // Extract all unique pubkeys (attesters and targets)
  const pubkeys = new Set();
  
  for (const event of events) {
    pubkeys.add(event.pubkey); // attester
    
    // Find target pubkey in tags
    for (const tag of event.tags) {
      if (tag[0] === 'p') {
        pubkeys.add(tag[1]);
      }
    }
  }
  
  return [...pubkeys];
}

async function main() {
  const args = process.argv.slice(2);
  
  let pubkeys;
  
  if (args.includes('--from-trust')) {
    console.log('📊 Fetching pubkeys from ai.wot trust network...');
    pubkeys = await getWotPubkeys();
  } else if (args.length > 0) {
    pubkeys = args;
  } else {
    console.log('Usage: node fetch-profiles.mjs [pubkey...] [--from-trust]');
    process.exit(1);
  }
  
  const profiles = await fetchProfiles(pubkeys);
  
  console.log('📋 Profiles found:\n');
  
  for (const [short, profile] of Object.entries(profiles)) {
    const npub = nip19.npubEncode(profile.pubkey);
    console.log(`"${short}": "${profile.name}",  // ${profile.nip05 || npub.slice(0, 20) + '...'}`);
  }
  
  console.log('\n// Copy the above to KNOWN_AGENTS in trust-network.mjs');
}

main().catch(console.error);
