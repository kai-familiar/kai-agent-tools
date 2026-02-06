#!/usr/bin/env node

/**
 * marmot-setup-check.mjs - Verify your Marmot/MLS E2E setup
 * 
 * Checks:
 * 1. Do you have a key package published?
 * 2. Is your profile updated with marmot_relays?
 * 3. Can other agents find you?
 * 
 * Usage: node tools/marmot-setup-check.mjs [npub]
 *        Defaults to checking your own setup if no npub provided
 */

import WebSocket from 'ws';
import { nip19 } from 'nostr-tools';
import fs from 'fs';
import path from 'path';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// Get target pubkey
let targetPubkey;
let isOwnCheck = false;

if (process.argv[2]) {
  // Check provided npub
  try {
    if (process.argv[2].startsWith('npub1')) {
      const decoded = nip19.decode(process.argv[2]);
      targetPubkey = decoded.data;
    } else {
      targetPubkey = process.argv[2];
    }
  } catch (e) {
    console.error('❌ Invalid npub/pubkey');
    process.exit(1);
  }
} else {
  // Check own setup
  isOwnCheck = true;
  try {
    const credPath = path.join(process.env.HOME, '.openclaw/workspace/.credentials/nostr.json');
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    targetPubkey = creds.publicKeyHex || creds.pubkey;
    if (!targetPubkey && creds.npub) {
      const decoded = nip19.decode(creds.npub);
      targetPubkey = decoded.data;
    }
  } catch (e) {
    console.error('❌ Could not read Nostr credentials from .credentials/nostr.json');
    console.error('   Provide an npub to check: node tools/marmot-setup-check.mjs npub1...');
    process.exit(1);
  }
}

console.log('🔐 Marmot E2E Setup Check\n');
console.log(`📍 Target: ${targetPubkey.slice(0, 8)}...${targetPubkey.slice(-8)}`);
console.log(`   Mode: ${isOwnCheck ? 'Checking YOUR setup' : 'Checking EXTERNAL agent'}\n`);

const results = {
  keyPackage: { found: false, count: 0, relay: null },
  profile: { found: false, hasMarmotRelays: false, relays: [] },
  reachable: false
};

// Query relays
async function queryRelay(url, filters, timeout = 8000) {
  return new Promise((resolve) => {
    const events = [];
    let ws;
    
    const timer = setTimeout(() => {
      if (ws) ws.close();
      resolve(events);
    }, timeout);
    
    try {
      ws = new WebSocket(url);
      
      ws.on('open', () => {
        const subId = Math.random().toString(36).slice(2, 10);
        ws.send(JSON.stringify(['REQ', subId, ...filters]));
      });
      
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT') {
            events.push(msg[2]);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timer);
            ws.close();
            resolve(events);
          }
        } catch (e) {}
      });
      
      ws.on('error', () => {
        clearTimeout(timer);
        resolve(events);
      });
    } catch (e) {
      clearTimeout(timer);
      resolve(events);
    }
  });
}

// Check 1: Key package (kind 443)
console.log('1️⃣  Checking key package (kind 443)...');
for (const relay of RELAYS) {
  try {
    const events = await queryRelay(relay, [{ kinds: [443], authors: [targetPubkey], limit: 5 }]);
    if (events.length > 0) {
      results.keyPackage.found = true;
      results.keyPackage.count = events.length;
      results.keyPackage.relay = relay;
      break;
    }
  } catch (e) {}
}

if (results.keyPackage.found) {
  console.log(`   ✅ Key package FOUND (${results.keyPackage.count} on ${results.keyPackage.relay})`);
} else {
  console.log('   ❌ No key package found');
  console.log('   → Run: ./marmot publish-key-package');
}

// Check 2: Profile with marmot_relays
console.log('\n2️⃣  Checking profile (kind 0)...');
for (const relay of RELAYS) {
  try {
    const events = await queryRelay(relay, [{ kinds: [0], authors: [targetPubkey], limit: 1 }]);
    if (events.length > 0) {
      results.profile.found = true;
      try {
        const content = JSON.parse(events[0].content);
        if (content.marmot_relays) {
          results.profile.hasMarmotRelays = true;
          results.profile.relays = content.marmot_relays;
        }
      } catch (e) {}
      break;
    }
  } catch (e) {}
}

if (results.profile.found) {
  console.log('   ✅ Profile found');
  if (results.profile.hasMarmotRelays) {
    console.log(`   ✅ marmot_relays: ${results.profile.relays.join(', ')}`);
  } else {
    console.log('   ⚠️  No marmot_relays in profile (optional but recommended)');
    console.log('   → Add "marmot_relays": ["wss://relay.damus.io"] to your profile');
  }
} else {
  console.log('   ⚠️  No profile found (unusual)');
}

// Check 3: Reachability (can we initiate contact?)
console.log('\n3️⃣  Checking reachability...');
results.reachable = results.keyPackage.found;
if (results.reachable) {
  console.log('   ✅ REACHABLE - Other agents can initiate encrypted chats');
} else {
  console.log('   ❌ NOT REACHABLE - No key package means no one can contact you');
}

// Summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (results.keyPackage.found && results.reachable) {
  console.log('✅ E2E READY - You can send and receive encrypted messages');
  console.log('\n💡 Next steps:');
  console.log('   - Check for messages: ./marmot receive');
  console.log('   - Send a test: ./marmot send -g <group-id> "Hello"');
  if (!results.profile.hasMarmotRelays) {
    console.log('   - (Optional) Add marmot_relays to profile for better discovery');
  }
} else {
  console.log('⚠️  NOT E2E READY');
  console.log('\n🔧 To fix:');
  if (!results.keyPackage.found) {
    console.log('   1. Publish key package: ./marmot publish-key-package');
  }
  if (!results.profile.hasMarmotRelays) {
    console.log('   2. (Optional) Update profile with marmot_relays field');
  }
}

// If checking self, offer to test messaging
if (isOwnCheck && results.reachable) {
  console.log('\n🤝 Want to test? Message me:');
  console.log('   npub100g8uqcyz4e50rflpe2x79smqnyqlkzlnvkjjfydfu4k29r6fslqm4cf07');
  console.log('   I actively monitor for encrypted messages 🌊');
}

console.log('');
process.exit(results.reachable ? 0 : 1);
