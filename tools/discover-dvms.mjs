#!/usr/bin/env node
/**
 * Discover DVMs on Nostr
 * Finds NIP-89 announcements (kind 31990) for data vending machines
 * 
 * Usage:
 *   node discover-dvms.mjs
 *   node discover-dvms.mjs --kind 5050   # Filter by specific job kind
 */

import WebSocket from 'ws';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// NIP-89 handler announcement kind
const HANDLER_ANNOUNCEMENT_KIND = 31990;

// Parse args
const args = process.argv.slice(2);
let filterKind = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--kind' && args[i + 1]) {
    filterKind = parseInt(args[++i], 10);
  } else if (args[i] === '--help') {
    console.log(`
🔍 Discover DVMs on Nostr

Usage:
  node discover-dvms.mjs [options]

Options:
  --kind <number>   Filter by specific job request kind (e.g., 5050)
  --help           Show this help

Examples:
  node discover-dvms.mjs                    # Find all DVMs
  node discover-dvms.mjs --kind 5050        # Find text generation DVMs
  node discover-dvms.mjs --kind 5100        # Find image generation DVMs
`);
    process.exit(0);
  }
}

console.log('🔍 Discovering DVMs on Nostr...\n');

const dvms = new Map();
let completedRelays = 0;

function queryRelay(url) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(url);
      const subId = `dvm-discover-${Date.now()}`;
      let timeout;

      ws.on('open', () => {
        // Query for NIP-89 handler announcements
        const filter = {
          kinds: [HANDLER_ANNOUNCEMENT_KIND],
          limit: 50
        };
        ws.send(JSON.stringify(['REQ', subId, filter]));
        
        // Timeout after 10 seconds
        timeout = setTimeout(() => {
          ws.close();
          resolve();
        }, 10000);
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT' && msg[1] === subId) {
            const event = msg[2];
            processAnnouncement(event);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        } catch (e) {}
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}

function processAnnouncement(event) {
  const tags = event.tags;
  
  // Get handler info
  const dTag = tags.find(t => t[0] === 'd');
  const kTag = tags.find(t => t[0] === 'k');
  const nameTag = tags.find(t => t[0] === 'name');
  const aboutTag = tags.find(t => t[0] === 'about');
  const webTag = tags.find(t => t[0] === 'web');
  
  const kind = kTag ? parseInt(kTag[1], 10) : null;
  
  // Skip if filtering and doesn't match
  if (filterKind && kind !== filterKind) {
    return;
  }
  
  // Only include DVM kinds (5000-5999)
  if (kind && (kind < 5000 || kind > 5999)) {
    return;
  }
  
  const id = `${event.pubkey}-${dTag?.[1] || 'unknown'}`;
  
  if (!dvms.has(id)) {
    dvms.set(id, {
      pubkey: event.pubkey,
      identifier: dTag?.[1],
      kind,
      name: nameTag?.[1] || 'Unknown DVM',
      about: aboutTag?.[1] || '',
      web: webTag?.[1] || null,
      created: event.created_at
    });
  }
}

async function main() {
  // Query all relays in parallel
  await Promise.all(RELAYS.map(url => queryRelay(url)));
  
  // Display results
  if (dvms.size === 0) {
    console.log('📭 No DVMs found' + (filterKind ? ` for kind ${filterKind}` : ''));
    console.log('\nThis could mean:');
    console.log('- Few DVMs have published NIP-89 announcements');
    console.log('- The relays don\'t index kind 31990 events');
    console.log('- DVMs exist but haven\'t announced themselves');
    process.exit(0);
  }
  
  console.log(`📦 Found ${dvms.size} DVM(s):\n`);
  
  const sorted = Array.from(dvms.values()).sort((a, b) => (b.created || 0) - (a.created || 0));
  
  for (const dvm of sorted) {
    console.log('────────────────────────────────────────────────────────────');
    console.log(`📛 ${dvm.name}`);
    console.log(`🔑 ${dvm.pubkey.slice(0, 16)}...`);
    if (dvm.kind) {
      console.log(`📋 Kind: ${dvm.kind} → ${dvm.kind + 1000}`);
    }
    if (dvm.about) {
      console.log(`📝 ${dvm.about.slice(0, 200)}${dvm.about.length > 200 ? '...' : ''}`);
    }
    if (dvm.web) {
      console.log(`🌐 ${dvm.web}`);
    }
    console.log('');
  }
  
  console.log(`✅ Checked ${RELAYS.length} relays`);
}

main().catch(console.error);
