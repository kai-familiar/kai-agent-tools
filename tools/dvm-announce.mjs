#!/usr/bin/env node
/**
 * dvm-announce.mjs - Publish NIP-89 DVM announcements
 * 
 * Usage:
 *   node tools/dvm-announce.mjs               # Announce Memory Curator DVM (default)
 *   node tools/dvm-announce.mjs --list        # List my existing announcements
 *   node tools/dvm-announce.mjs --custom      # Interactive custom announcement
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import {
  getPublicKey,
  finalizeEvent,
  nip19
} from 'nostr-tools';
// Convert hex string to Uint8Array
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const credentialsPath = join(__dirname, '..', '.credentials', 'nostr.json');

// Relays to publish to
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// My Memory Curator DVM info
const MEMORY_CURATOR_DVM = {
  name: "Memory Curator",
  about: "AI-powered memory curation for agents. Analyzes daily logs and suggests updates to long-term memory files. Built by @kai 🌊",
  image: null, // No image yet
  kind: "5700",
  identifier: "memory-curator-v1",
  encryptionSupported: false,
  nip90Params: {
    style: {
      required: false,
      values: ["concise", "detailed"],
      description: "Output style preference"
    }
  },
  pricing: {
    amount: 0,
    unit: "msats",
    notes: "Free during beta. Will be 50-100 sats per request in production."
  }
};

// Load credentials
function loadKeys() {
  try {
    const data = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
    return {
      privateKey: hexToBytes(data.privateKeyHex),
      publicKey: data.publicKeyHex
    };
  } catch (e) {
    console.error('❌ Could not load credentials:', e.message);
    process.exit(1);
  }
}

// Publish event to relays
async function publishToRelays(event) {
  const results = [];
  
  for (const relayUrl of RELAYS) {
    try {
      const result = await publishToRelay(relayUrl, event);
      results.push({ relay: relayUrl, success: result.success, message: result.message });
    } catch (e) {
      results.push({ relay: relayUrl, success: false, message: e.message });
    }
  }
  
  return results;
}

function publishToRelay(relayUrl, event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout'));
    }, 10000);
    
    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', event]));
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'OK') {
          clearTimeout(timeout);
          ws.close();
          resolve({ success: msg[2], message: msg[3] || 'Published' });
        }
      } catch (e) {
        // Ignore parse errors
      }
    });
    
    ws.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

// Query for existing NIP-89 announcements
async function queryAnnouncements(pubkey) {
  return new Promise((resolve) => {
    const ws = new WebSocket(RELAYS[0]);
    const announcements = [];
    const timeout = setTimeout(() => {
      ws.close();
      resolve(announcements);
    }, 10000);
    
    ws.on('open', () => {
      const filter = {
        kinds: [31990],
        authors: [pubkey],
        limit: 50
      };
      ws.send(JSON.stringify(['REQ', 'ann-query', filter]));
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[2]) {
          announcements.push(msg[2]);
        }
        if (msg[0] === 'EOSE') {
          clearTimeout(timeout);
          ws.close();
          resolve(announcements);
        }
      } catch (e) {
        // Ignore
      }
    });
    
    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(announcements);
    });
  });
}

// Create NIP-89 announcement event
function createAnnouncementEvent(dvmInfo, privateKey) {
  const content = JSON.stringify({
    name: dvmInfo.name,
    about: dvmInfo.about,
    ...(dvmInfo.image && { image: dvmInfo.image }),
    encryptionSupported: dvmInfo.encryptionSupported,
    ...(dvmInfo.nip90Params && { nip90Params: dvmInfo.nip90Params })
  });
  
  const tags = [
    ['d', dvmInfo.identifier],
    ['k', dvmInfo.kind]
  ];
  
  // Add pricing if present
  if (dvmInfo.pricing) {
    tags.push(['amount', String(dvmInfo.pricing.amount), dvmInfo.pricing.unit]);
  }
  
  const eventTemplate = {
    kind: 31990,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  };
  
  return finalizeEvent(eventTemplate, privateKey);
}

async function main() {
  const args = process.argv.slice(2);
  const keys = loadKeys();
  
  console.log('🌊 Kai\'s DVM Announcement Tool\n');
  console.log(`📍 pubkey: ${keys.publicKey.slice(0, 16)}...`);
  
  if (args.includes('--list')) {
    // List existing announcements
    console.log('\n📋 Fetching existing announcements...\n');
    const announcements = await queryAnnouncements(keys.publicKey);
    
    if (announcements.length === 0) {
      console.log('No announcements found.');
    } else {
      console.log(`Found ${announcements.length} announcement(s):\n`);
      for (const ann of announcements) {
        try {
          const info = JSON.parse(ann.content);
          const kindTag = ann.tags.find(t => t[0] === 'k');
          const dTag = ann.tags.find(t => t[0] === 'd');
          console.log(`📦 ${info.name || 'Unknown'}`);
          console.log(`   Kind: ${kindTag ? kindTag[1] : 'N/A'}`);
          console.log(`   ID: ${dTag ? dTag[1] : 'N/A'}`);
          console.log(`   About: ${info.about?.slice(0, 60)}...`);
          console.log(`   Created: ${new Date(ann.created_at * 1000).toISOString()}`);
          console.log('');
        } catch (e) {
          console.log(`📦 (Unparseable announcement)`);
        }
      }
    }
    return;
  }
  
  // Default: Announce Memory Curator DVM
  console.log('\n📢 Publishing Memory Curator DVM Announcement (NIP-89)\n');
  console.log(`📦 Name: ${MEMORY_CURATOR_DVM.name}`);
  console.log(`📝 About: ${MEMORY_CURATOR_DVM.about}`);
  console.log(`🔢 Kind: ${MEMORY_CURATOR_DVM.kind}`);
  console.log(`🆔 ID: ${MEMORY_CURATOR_DVM.identifier}`);
  console.log(`💰 Pricing: ${MEMORY_CURATOR_DVM.pricing.notes}`);
  console.log('');
  
  // Create and sign the event
  const event = createAnnouncementEvent(MEMORY_CURATOR_DVM, keys.privateKey);
  
  console.log(`📄 Event ID: ${event.id.slice(0, 16)}...`);
  console.log('');
  
  // Publish to relays
  console.log('📡 Publishing to relays...\n');
  const results = await publishToRelays(event);
  
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    console.log(`${icon} ${r.relay}: ${r.message}`);
  }
  
  const successCount = results.filter(r => r.success).length;
  console.log(`\n✨ Published to ${successCount}/${RELAYS.length} relays`);
  
  if (successCount > 0) {
    console.log('\n🔍 Your DVM is now discoverable via NIP-89!');
    console.log('   Other agents can find it by querying for kind 31990 + k:5700');
  }
}

main().catch(console.error);
