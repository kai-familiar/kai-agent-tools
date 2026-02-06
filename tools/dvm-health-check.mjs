#!/usr/bin/env node

/**
 * DVM Health Check
 * 
 * Tests which DVMs actually respond to requests.
 * Built by Kai 🌊 on Day 5 — addressing the "announce but don't respond" problem.
 * 
 * Usage:
 *   node dvm-health-check.mjs                    # Check 5 random DVMs
 *   node dvm-health-check.mjs --kind 5050        # Specific kind
 *   node dvm-health-check.mjs --count 10         # Check more DVMs
 *   node dvm-health-check.mjs --pubkey abc123    # Check specific DVM
 *   node dvm-health-check.mjs --timeout 30       # Custom timeout (seconds)
 */

import WebSocket from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

const relays = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://dvms.f7z.io'
];

const credentials = JSON.parse(fs.readFileSync('.credentials/nostr.json', 'utf8'));
const privateKey = credentials.privateKeyHex;
const publicKey = credentials.publicKeyHex;

function signEvent(eventTemplate) {
  // Use nostr-tools finalizeEvent for proper signing
  return finalizeEvent(eventTemplate, Buffer.from(privateKey, 'hex'));
}

async function discoverDVMs(kind = 5050, limit = 20) {
  return new Promise((resolve) => {
    const dvms = new Map();
    const ws = new WebSocket(relays[0]);
    const subId = `discover-${Date.now()}`;
    
    const timeout = setTimeout(() => {
      ws.close();
      resolve(Array.from(dvms.values()));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify([
        'REQ',
        subId,
        { kinds: [31990], '#k': [String(kind)], limit: 100 }
      ]));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[2]) {
          const event = msg[2];
          if (!dvms.has(event.pubkey)) {
            // Parse profile info from tags
            const dTag = event.tags.find(t => t[0] === 'd')?.[1];
            const name = event.tags.find(t => t[0] === 'name')?.[1] || dTag || 'Unknown';
            dvms.set(event.pubkey, {
              pubkey: event.pubkey,
              name: name,
              eventId: event.id
            });
          }
        }
        if (msg[0] === 'EOSE') {
          clearTimeout(timeout);
          ws.close();
          resolve(Array.from(dvms.values()));
        }
      } catch (e) {}
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve(Array.from(dvms.values()));
    });
  });
}

async function testDVM(dvm, kind = 5050, timeoutSeconds = 20) {
  return new Promise((resolve) => {
    const testPrompt = kind === 5050 
      ? 'Reply with just "OK" to confirm you are responding.'
      : 'Test request';
    
    const event = signEvent({
      kind: kind,
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['i', testPrompt, 'text'],
        ['p', dvm.pubkey]
      ],
      content: ''
    });

    const result = {
      pubkey: dvm.pubkey,
      name: dvm.name,
      responded: false,
      responseTime: null,
      error: null
    };

    const startTime = Date.now();
    let responseSeen = false;
    let ws;

    const timeout = setTimeout(() => {
      if (!responseSeen) {
        result.error = 'timeout';
        try { ws?.close(); } catch {}
        resolve(result);
      }
    }, timeoutSeconds * 1000);

    try {
      ws = new WebSocket(relays[1]); // Use nos.lol - more reliable
      const subId = `test-${Date.now()}`;

      ws.on('open', () => {
        // Subscribe to responses
        ws.send(JSON.stringify([
          'REQ',
          subId,
          { 
            kinds: [kind + 1000, 7000], // Result and status kinds
            '#e': [event.id],
            since: event.created_at - 10
          }
        ]));
        // Publish test request
        ws.send(JSON.stringify(['EVENT', event]));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT' && msg[2]) {
            const respEvent = msg[2];
            // Check if it's a response to our request
            const eTag = respEvent.tags.find(t => t[0] === 'e' && t[1] === event.id);
            if (eTag && respEvent.pubkey === dvm.pubkey) {
              responseSeen = true;
              result.responded = true;
              result.responseTime = Date.now() - startTime;
              clearTimeout(timeout);
              ws.close();
              resolve(result);
            }
          }
        } catch (e) {}
      });

      ws.on('error', (e) => {
        if (!responseSeen) {
          result.error = 'connection';
          clearTimeout(timeout);
          resolve(result);
        }
      });

    } catch (e) {
      result.error = 'connection';
      clearTimeout(timeout);
      resolve(result);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const kind = parseInt(args.find((a, i) => args[i-1] === '--kind') || '5050');
  const count = parseInt(args.find((a, i) => args[i-1] === '--count') || '5');
  const timeout = parseInt(args.find((a, i) => args[i-1] === '--timeout') || '20');
  const specificPubkey = args.find((a, i) => args[i-1] === '--pubkey');

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🏥 DVM Health Check                                          ║
║   Testing which DVMs actually respond                          ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);

  console.log(`📊 Kind: ${kind} | Testing: ${specificPubkey ? '1 specific DVM' : `${count} random DVMs`} | Timeout: ${timeout}s\n`);

  // Discover DVMs
  console.log('🔍 Discovering DVMs...');
  const allDvms = await discoverDVMs(kind);
  console.log(`   Found ${allDvms.length} announced DVMs\n`);

  if (allDvms.length === 0) {
    console.log('❌ No DVMs found for this kind');
    process.exit(1);
  }

  // Select DVMs to test
  let toTest;
  if (specificPubkey) {
    const dvm = allDvms.find(d => d.pubkey.startsWith(specificPubkey));
    if (!dvm) {
      console.log(`❌ DVM not found: ${specificPubkey}`);
      process.exit(1);
    }
    toTest = [dvm];
  } else {
    // Shuffle and take first N
    const shuffled = allDvms.sort(() => Math.random() - 0.5);
    toTest = shuffled.slice(0, Math.min(count, shuffled.length));
  }

  console.log('🧪 Testing DVMs:\n');
  const results = [];

  for (const dvm of toTest) {
    process.stdout.write(`   Testing ${dvm.name.substring(0, 30).padEnd(30)}... `);
    const result = await testDVM(dvm, kind, timeout);
    results.push(result);

    if (result.responded) {
      console.log(`✅ ${result.responseTime}ms`);
    } else if (result.error === 'timeout') {
      console.log(`⏱️  Timeout`);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  // Summary
  const responding = results.filter(r => r.responded);
  const timedOut = results.filter(r => r.error === 'timeout');
  const errored = results.filter(r => r.error && r.error !== 'timeout');

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Summary:
   ✅ Responding: ${responding.length}/${results.length} (${Math.round(responding.length/results.length*100)}%)
   ⏱️  Timed out: ${timedOut.length}
   ❌ Errors: ${errored.length}
`);

  if (responding.length > 0) {
    const avgTime = Math.round(responding.reduce((a, r) => a + r.responseTime, 0) / responding.length);
    console.log(`   ⚡ Average response time: ${avgTime}ms`);
    
    console.log(`\n✅ Working DVMs:`);
    for (const r of responding) {
      console.log(`   • ${r.name} (${r.pubkey.substring(0, 12)}...)`);
    }
  }

  if (timedOut.length > 0) {
    console.log(`\n⏱️  Non-responsive (announced but not responding):`);
    for (const r of timedOut) {
      console.log(`   • ${r.name} (${r.pubkey.substring(0, 12)}...)`);
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Built by Kai 🌊 | Day 5 | https://github.com/kai-familiar
`);
}

main().catch(console.error);
