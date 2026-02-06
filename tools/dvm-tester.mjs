#!/usr/bin/env node
/**
 * dvm-tester.mjs - Quick DVM testing tool
 * Tests any NIP-90 DVM by sending a sample job and waiting for results.
 * 
 * Usage:
 *   node dvm-tester.mjs <dvm-pubkey> <kind> [input-text]
 *   node dvm-tester.mjs --memory <dvm-pubkey>   # Tests kind 5700 with sample memory
 *   node dvm-tester.mjs --list                   # Shows known DVMs
 * 
 * Examples:
 *   node dvm-tester.mjs 7bd07e03041573478d3f0e546f161b04c80fd85f9b2d29248d4f2b65147a4c3e 5700
 *   node dvm-tester.mjs --memory kai   # Quick test Kai's Memory Curator
 * 
 * Part of kai-agent-tools
 */

import WebSocket from 'ws';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load credentials
const credsPath = join(__dirname, '..', '.credentials', 'nostr.json');
let nsec, pubkey;
if (existsSync(credsPath)) {
  const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
  nsec = creds.nsec;
  pubkey = creds.pubkey;
} else {
  console.error('❌ No credentials found at', credsPath);
  process.exit(1);
}

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// Known DVMs for quick testing
const KNOWN_DVMS = {
  'kai': {
    pubkey: '7bd07e03041573478d3f0e546f161b04c80fd85f9b2d29248d4f2b65147a4c3e',
    kind: 5700,
    name: 'Kai Memory Curator',
    description: 'Curates daily logs into memory suggestions'
  },
  'jeletor-wot': {
    pubkey: 'dc52438efbf965d35738743daf9f7c718976462b010aa4e5ed24e569825bae94',
    kind: 5301,
    name: 'Jeletor WoT Lookup',
    description: 'Web of Trust score lookup'
  }
};

// Sample inputs by kind
const SAMPLE_INPUTS = {
  5700: {
    daily_log: `# Sample Daily Log
## Session 1 (10:00)
- Tested the Memory Curator DVM
- It worked! Got structured suggestions back.

## Key Insight
Testing DVMs should be easier.

## Tools Used
- dvm-tester.mjs`,
    memory_file: `# MEMORY.md
- I'm testing DVMs
- Need to track what works`
  },
  5050: 'Write a haiku about Nostr',
  5300: 'Find recent posts about AI agents',
  5301: '' // WoT lookup uses pubkey input
};

function getSecretKey() {
  if (nsec.startsWith('nsec')) {
    return nip19.decode(nsec).data;
  }
  return Buffer.from(nsec, 'hex');
}

async function sendDVMJob(dvmPubkey, kind, inputData) {
  const sk = getSecretKey();
  
  // Build tags based on kind
  const tags = [
    ['p', dvmPubkey],
    ['relays', ...RELAYS]
  ];
  
  // Handle input based on type
  let content = '';
  if (typeof inputData === 'object') {
    // For complex inputs like memory curator, put in content
    content = JSON.stringify(inputData);
    tags.push(['i', 'json_content', 'data', 'inputs_in_content']);
  } else if (inputData) {
    tags.push(['i', inputData, 'text']);
  }
  
  const eventTemplate = {
    kind: kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: tags,
    content: content
  };
  
  const signedEvent = finalizeEvent(eventTemplate, sk);
  return signedEvent;
}

async function testDVM(dvmPubkey, kind, inputData, timeoutSec = 30) {
  console.log('\n🧪 DVM Tester\n');
  console.log(`📍 Target DVM: ${dvmPubkey.slice(0, 16)}...`);
  console.log(`📦 Kind: ${kind}`);
  console.log(`⏱️  Timeout: ${timeoutSec}s\n`);
  
  const jobEvent = await sendDVMJob(dvmPubkey, kind, inputData);
  
  console.log(`📤 Sending job...`);
  console.log(`   Event ID: ${jobEvent.id.slice(0, 16)}...`);
  
  return new Promise((resolve) => {
    let received = false;
    let connectedCount = 0;
    const sockets = [];
    
    const resultKind = kind + 1000; // NIP-90: result kind = job kind + 1000
    
    RELAYS.forEach(url => {
      const ws = new WebSocket(url);
      sockets.push(ws);
      
      ws.on('open', () => {
        connectedCount++;
        // Publish the job
        ws.send(JSON.stringify(['EVENT', jobEvent]));
        
        // Subscribe to results
        ws.send(JSON.stringify(['REQ', 'results', {
          kinds: [resultKind, 7000], // Result + feedback
          '#e': [jobEvent.id],
          since: jobEvent.created_at - 10
        }]));
        
        if (connectedCount === 1) {
          console.log(`✅ Connected to ${connectedCount} relay(s)`);
          console.log(`⏳ Waiting for response...\n`);
        }
      });
      
      ws.on('message', data => {
        const msg = JSON.parse(data.toString());
        
        if (msg[0] === 'OK' && msg[1] === jobEvent.id) {
          if (msg[2]) {
            console.log(`✅ Job accepted by relay`);
          } else {
            console.log(`⚠️  Job rejected: ${msg[3]}`);
          }
        }
        
        if (msg[0] === 'EVENT' && msg[2]) {
          const e = msg[2];
          
          if (e.kind === 7000) {
            // Feedback event
            const status = e.tags.find(t => t[0] === 'status');
            if (status) {
              console.log(`📡 Status: ${status[1]} ${status[2] || ''}`);
            }
          }
          
          if (e.kind === resultKind) {
            received = true;
            console.log(`\n✅ RESULT RECEIVED!\n`);
            console.log(`From: ${e.pubkey.slice(0, 16)}...`);
            console.log(`Time: ${new Date(e.created_at * 1000).toLocaleString()}`);
            console.log(`\n--- Content ---\n`);
            
            // Try to pretty-print JSON
            try {
              const parsed = JSON.parse(e.content);
              console.log(JSON.stringify(parsed, null, 2));
            } catch {
              console.log(e.content);
            }
            
            console.log(`\n--- End ---\n`);
            cleanup();
            resolve({ success: true, result: e });
          }
        }
      });
      
      ws.on('error', () => {});
    });
    
    const cleanup = () => {
      sockets.forEach(ws => {
        try { ws.close(); } catch {}
      });
    };
    
    setTimeout(() => {
      if (!received) {
        console.log(`\n⏱️  Timeout after ${timeoutSec}s - no response received`);
        console.log(`\nPossible reasons:`);
        console.log(`  - DVM might be offline`);
        console.log(`  - DVM might not support this kind`);
        console.log(`  - Input format might be incorrect`);
        cleanup();
        resolve({ success: false, error: 'timeout' });
      }
    }, timeoutSec * 1000);
  });
}

function showHelp() {
  console.log(`
🧪 DVM Tester - Quick NIP-90 DVM testing

Usage:
  node dvm-tester.mjs <dvm-pubkey> <kind> [input]
  node dvm-tester.mjs --memory <name|pubkey>   Test kind 5700 Memory Curator
  node dvm-tester.mjs --list                   List known DVMs

Known DVMs:`);
  
  Object.entries(KNOWN_DVMS).forEach(([key, dvm]) => {
    console.log(`  ${key.padEnd(15)} ${dvm.name} (kind ${dvm.kind})`);
  });
  
  console.log(`
Examples:
  node dvm-tester.mjs kai 5700
  node dvm-tester.mjs --memory kai
  node dvm-tester.mjs <pubkey> 5050 "Write a haiku"
`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }
  
  if (args[0] === '--list') {
    console.log('\n📋 Known DVMs:\n');
    Object.entries(KNOWN_DVMS).forEach(([key, dvm]) => {
      console.log(`${key}:`);
      console.log(`  Name: ${dvm.name}`);
      console.log(`  Kind: ${dvm.kind}`);
      console.log(`  Pubkey: ${dvm.pubkey}`);
      console.log(`  Description: ${dvm.description}\n`);
    });
    return;
  }
  
  if (args[0] === '--memory') {
    // Quick memory curator test
    const target = args[1] || 'kai';
    const dvm = KNOWN_DVMS[target] || { pubkey: target, kind: 5700 };
    await testDVM(dvm.pubkey, 5700, SAMPLE_INPUTS[5700], 45);
    return;
  }
  
  // Standard: pubkey kind [input]
  let dvmPubkey = args[0];
  let kind = parseInt(args[1]) || 5700;
  let input = args[2] || SAMPLE_INPUTS[kind] || 'test';
  
  // Resolve shortnames
  if (KNOWN_DVMS[dvmPubkey]) {
    const dvm = KNOWN_DVMS[dvmPubkey];
    dvmPubkey = dvm.pubkey;
    kind = kind || dvm.kind;
  }
  
  await testDVM(dvmPubkey, kind, input);
}

main().catch(console.error);
