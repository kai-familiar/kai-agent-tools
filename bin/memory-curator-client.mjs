#!/usr/bin/env node
/**
 * Memory Curator DVM Client
 * Send job requests to Memory Curator DVMs (kind 5700)
 * 
 * Usage:
 *   node memory-curator-client.mjs <daily-log-file> [--memory MEMORY.md]
 *   node memory-curator-client.mjs memory/2026-02-05.md
 *   node memory-curator-client.mjs memory/2026-02-05.md --memory MEMORY.md --timeout 60
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import {
  getPublicKey,
  finalizeEvent,
  nip19
} from 'nostr-tools';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = dirname(__dirname);

// Load credentials
const credentialsPath = join(WORKSPACE, '.credentials', 'nostr.json');
if (!existsSync(credentialsPath)) {
  console.error('❌ No credentials found at .credentials/nostr.json');
  process.exit(1);
}
const { nsec } = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const decoded = nip19.decode(nsec);
const privateKey = decoded.data;
const publicKey = getPublicKey(privateKey);

// Relays
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// DVM kinds
const JOB_REQUEST_KIND = 5700;
const JOB_RESULT_KIND = 6700;
const JOB_STATUS_KIND = 7000;

// Parse args
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(`
🌊 Memory Curator DVM Client

Usage:
  node memory-curator-client.mjs <daily-log-file> [options]

Options:
  --memory <file>   Current MEMORY.md file (optional)
  --timeout <secs>  Wait time for response (default: 30)
  --style <style>   Output style: concise|detailed (default: concise)
  
Examples:
  node memory-curator-client.mjs memory/2026-02-05.md
  node memory-curator-client.mjs memory/2026-02-05.md --memory MEMORY.md
  node memory-curator-client.mjs daily.md --timeout 60 --style detailed
`);
  process.exit(0);
}

// Parse arguments
let dailyLogPath = null;
let memoryPath = null;
let timeout = 30;
let style = 'concise';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--memory' && args[i + 1]) {
    memoryPath = args[++i];
  } else if (args[i] === '--timeout' && args[i + 1]) {
    timeout = parseInt(args[++i], 10);
  } else if (args[i] === '--style' && args[i + 1]) {
    style = args[++i];
  } else if (!args[i].startsWith('--')) {
    dailyLogPath = args[i];
  }
}

if (!dailyLogPath) {
  console.error('❌ Please provide a daily log file');
  process.exit(1);
}

// Resolve paths
const fullDailyPath = dailyLogPath.startsWith('/') ? dailyLogPath : join(WORKSPACE, dailyLogPath);
if (!existsSync(fullDailyPath)) {
  console.error(`❌ Daily log not found: ${fullDailyPath}`);
  process.exit(1);
}

const dailyContent = readFileSync(fullDailyPath, 'utf8');
let memoryContent = '';
if (memoryPath) {
  const fullMemoryPath = memoryPath.startsWith('/') ? memoryPath : join(WORKSPACE, memoryPath);
  if (existsSync(fullMemoryPath)) {
    memoryContent = readFileSync(fullMemoryPath, 'utf8');
  }
}

console.log('🌊 Memory Curator DVM Client\n');
console.log(`📄 Daily log: ${dailyLogPath} (${dailyContent.length} bytes)`);
if (memoryContent) {
  console.log(`📝 Memory file: ${memoryPath} (${memoryContent.length} bytes)`);
}
console.log(`⏱️  Timeout: ${timeout}s`);
console.log(`🎨 Style: ${style}\n`);

// Create job request
// NIP-90 allows content field for large data
// We'll put the data in content as JSON when it's too large for tags
const MAX_TAG_SIZE = 1000; // Most relays accept ~1KB per tag value

const tags = [
  ['param', 'style', style]
];

let content = '';

// If inputs are small, use tags. If large, use content field
const dailySmall = dailyContent.length <= MAX_TAG_SIZE;
const memorySmall = !memoryContent || memoryContent.length <= MAX_TAG_SIZE;

if (dailySmall && memorySmall) {
  // Small inputs: use tags
  tags.push(['i', dailyContent, 'text', 'daily_log']);
  if (memoryContent) {
    tags.push(['i', memoryContent, 'text', 'memory_file']);
  }
} else {
  // Large inputs: put in content field as JSON
  const inputData = {
    daily_log: dailyContent,
    memory_file: memoryContent || null
  };
  content = JSON.stringify(inputData);
  tags.push(['i', 'json_content', 'data', 'inputs_in_content']);
  console.log(`📦 Large input - using content field (${content.length} bytes)\n`);
}

const jobRequest = {
  kind: JOB_REQUEST_KIND,
  created_at: Math.floor(Date.now() / 1000),
  tags,
  content
};

const signedJob = finalizeEvent(jobRequest, privateKey);
const jobEventId = signedJob.id;

console.log(`📤 Job request ID: ${jobEventId}`);
console.log(`🔍 Looking for DVMs...\n`);

// Track responses
let resultReceived = false;
const statusUpdates = [];
const sockets = [];

// Connect to relays and send job
async function run() {
  const connectionPromises = RELAYS.map(url => {
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      sockets.push(ws);
      
      ws.on('open', () => {
        console.log(`📡 Connected to ${url}`);
        
        // Subscribe to responses for our job
        const subId = crypto.randomBytes(8).toString('hex');
        ws.send(JSON.stringify([
          'REQ',
          subId,
          {
            kinds: [JOB_RESULT_KIND, JOB_STATUS_KIND],
            '#e': [jobEventId],
            since: Math.floor(Date.now() / 1000) - 10
          }
        ]));
        
        // Send the job request
        ws.send(JSON.stringify(['EVENT', signedJob]));
        resolve(true);
      });
      
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT') {
            const event = msg[2];
            
            if (event.kind === JOB_STATUS_KIND) {
              const statusTag = event.tags.find(t => t[0] === 'status');
              const status = statusTag ? statusTag[1] : 'unknown';
              console.log(`📊 Status update: ${status}`);
              statusUpdates.push({ status, time: new Date() });
            }
            
            if (event.kind === JOB_RESULT_KIND && !resultReceived) {
              resultReceived = true;
              console.log('\n✅ Result received!\n');
              console.log('─'.repeat(60));
              console.log(event.content);
              console.log('─'.repeat(60));
              
              // Check for amount tag (payment requested)
              const amountTag = event.tags.find(t => t[0] === 'amount');
              if (amountTag) {
                console.log(`\n💰 Payment requested: ${amountTag[1]} msats`);
              }
              
              cleanup();
              process.exit(0);
            }
          }
          
          if (msg[0] === 'OK') {
            const [, eventId, accepted, message] = msg;
            if (eventId === jobEventId) {
              if (accepted) {
                console.log(`✓ Job accepted by ${url}`);
              } else {
                console.log(`✗ Job rejected by ${url}: ${message}`);
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      });
      
      ws.on('error', (err) => {
        console.log(`⚠️ Error on ${url}: ${err.message}`);
        resolve(false);
      });
      
      ws.on('close', () => {
        // Normal close
      });
      
      // Timeout for initial connection
      setTimeout(() => resolve(false), 5000);
    });
  });
  
  await Promise.all(connectionPromises);
  
  console.log(`\n⏳ Waiting up to ${timeout}s for DVM response...\n`);
  
  // Wait for result or timeout
  await new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (resultReceived) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
    
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, timeout * 1000);
  });
  
  if (!resultReceived) {
    console.log('\n⏱️ Timeout reached. No DVM response received.');
    console.log('\nPossible reasons:');
    console.log('  • No DVMs are currently listening for kind 5700');
    console.log('  • DVM is processing but taking longer');
    console.log('  • Network/relay issues');
    console.log('\nTry increasing --timeout or check if any Memory Curator DVMs are online.');
  }
  
  cleanup();
}

function cleanup() {
  for (const ws of sockets) {
    try {
      ws.close();
    } catch (e) {
      // Ignore
    }
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🛑 Interrupted');
  cleanup();
  process.exit(0);
});

run().catch(err => {
  console.error('Error:', err);
  cleanup();
  process.exit(1);
});
