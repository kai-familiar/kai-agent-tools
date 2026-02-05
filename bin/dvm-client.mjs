#!/usr/bin/env node
/**
 * Generic DVM Client - Submit jobs to any NIP-90 DVM
 * 
 * Usage:
 *   node dvm-client.mjs text "Generate a haiku about Bitcoin" --kind 5050
 *   node dvm-client.mjs discover --kind 5050
 *   node dvm-client.mjs listen <event-id>
 */

import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools';
import { readFileSync, existsSync } from 'fs';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// Load credentials
function loadCredentials() {
  const credPath = new URL('../.credentials/nostr.json', import.meta.url).pathname;
  if (existsSync(credPath)) {
    const creds = JSON.parse(readFileSync(credPath, 'utf8'));
    const skHex = creds.privateKeyHex || creds.privateKey;
    const pkHex = creds.publicKeyHex || creds.publicKey;
    return {
      sk: Uint8Array.from(Buffer.from(skHex, 'hex')),
      pk: pkHex
    };
  }
  // Fallback to ephemeral key
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}

async function submitJob(kind, input, options = {}) {
  const pool = new SimplePool();
  const { sk, pk } = loadCredentials();
  
  console.log(`🚀 Submitting kind ${kind} job...`);
  console.log(`📝 Input: "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"`);
  
  // Build tags
  const tags = [
    ['i', input, 'text']
  ];
  
  // Add optional params
  if (options.output) tags.push(['output', options.output]);
  if (options.bid) tags.push(['bid', options.bid.toString()]);
  if (options.relays) {
    options.relays.forEach(r => tags.push(['relay', r]));
  } else {
    RELAYS.forEach(r => tags.push(['relay', r]));
  }
  
  // Create job request event
  const event = finalizeEvent({
    kind: parseInt(kind),
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  }, sk);
  
  // Publish
  const results = await Promise.allSettled(
    RELAYS.map(r => pool.publish([r], event))
  );
  
  const published = results.filter(r => r.status === 'fulfilled').length;
  console.log(`📤 Published to ${published}/${RELAYS.length} relays`);
  console.log(`🔗 Event ID: ${event.id}`);
  
  // Poll for results using querySync
  console.log('\n⏳ Waiting for DVM response...\n');
  
  const resultKind = parseInt(kind) + 1000; // 5050 → 6050
  const statusKind = 7000;
  const startTime = Date.now();
  const maxWait = 60000; // 60 seconds
  
  while (Date.now() - startTime < maxWait) {
    await new Promise(r => setTimeout(r, 3000)); // Poll every 3s
    
    try {
      // Check for results
      const results = await pool.querySync(RELAYS, {
        kinds: [resultKind],
        '#e': [event.id]
      });
      
      if (results.length > 0) {
        const result = results[0];
        console.log('✅ Result received!\n');
        console.log('────────────────────────────────────────');
        console.log(result.content);
        console.log('────────────────────────────────────────\n');
        
        // Check for invoice
        const invoiceTag = result.tags.find(t => t[0] === 'amount');
        if (invoiceTag && invoiceTag[2]) {
          console.log(`💰 Payment requested: ${invoiceTag[2]}`);
        }
        
        pool.close(RELAYS);
        return result;
      }
      
      // Check for status updates
      const statuses = await pool.querySync(RELAYS, {
        kinds: [statusKind],
        '#e': [event.id]
      });
      
      if (statuses.length > 0) {
        const latest = statuses.sort((a, b) => b.created_at - a.created_at)[0];
        const statusTag = latest.tags.find(t => t[0] === 'status');
        process.stdout.write(`\r📊 Status: ${statusTag?.[1] || 'processing'}...`);
      }
      
    } catch (e) {
      // Ignore query errors, keep polling
    }
  }
  
  console.log('\n⏰ Timeout - no response received');
  pool.close(RELAYS);
  return null;
}

async function discoverDVMs(kind) {
  const pool = new SimplePool();
  console.log(`🔍 Discovering DVMs for kind ${kind}...\n`);
  
  try {
    const events = await pool.querySync(RELAYS, {
      kinds: [31990],
      '#k': [kind.toString()]
    });
    
    const dvms = events.map(ev => {
      try {
        const profile = JSON.parse(ev.content);
        return {
          pubkey: ev.pubkey,
          name: profile.name,
          about: profile.about,
          event: ev
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
    
    console.log(`📊 Found ${dvms.length} DVM(s) for kind ${kind}\n`);
    dvms.forEach((d, i) => {
      console.log(`${i + 1}. ${d.name || 'Unknown'}`);
      console.log(`   Pubkey: ${d.pubkey.substring(0, 16)}...`);
      if (d.about) console.log(`   About: ${d.about.substring(0, 80)}`);
      console.log('');
    });
    
    pool.close(RELAYS);
    return dvms;
  } catch (e) {
    console.error('Error:', e.message);
    pool.close(RELAYS);
    return [];
  }
}

async function listenForResult(eventId, timeoutMs = 60000) {
  const pool = new SimplePool();
  console.log(`👂 Listening for responses to ${eventId}...\n`);
  
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check for results (common result kinds)
      const results = await pool.querySync(RELAYS, {
        kinds: [6050, 6300, 6600],
        '#e': [eventId]
      });
      
      if (results.length > 0) {
        const result = results[0];
        console.log(`\n✅ Result (kind ${result.kind}):\n`);
        console.log(result.content);
        pool.close(RELAYS);
        return result;
      }
      
      // Check for status updates
      const statuses = await pool.querySync(RELAYS, {
        kinds: [7000],
        '#e': [eventId]
      });
      
      if (statuses.length > 0) {
        const latest = statuses.sort((a, b) => b.created_at - a.created_at)[0];
        const statusTag = latest.tags.find(t => t[0] === 'status');
        console.log(`📊 Status: ${statusTag?.[1] || 'processing'}`);
      }
      
    } catch (e) {
      // Ignore errors, keep polling
    }
    
    await new Promise(r => setTimeout(r, 3000)); // Poll every 3s
  }
  
  console.log('⏰ Timeout');
  pool.close(RELAYS);
  return null;
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

if (command === 'text' || command === 'submit') {
  const input = args[1];
  const kindIdx = args.indexOf('--kind');
  const kind = kindIdx >= 0 ? args[kindIdx + 1] : '5050';
  
  if (!input) {
    console.log('Usage: node dvm-client.mjs text "your prompt" --kind 5050');
    process.exit(1);
  }
  
  submitJob(kind, input).catch(console.error);
  
} else if (command === 'discover') {
  const kindIdx = args.indexOf('--kind');
  const kind = kindIdx >= 0 ? args[kindIdx + 1] : '5050';
  discoverDVMs(kind).catch(console.error);
  
} else if (command === 'listen') {
  const eventId = args[1];
  if (!eventId) {
    console.log('Usage: node dvm-client.mjs listen <event-id>');
    process.exit(1);
  }
  listenForResult(eventId).catch(console.error);
  
} else {
  console.log(`
🔧 Generic DVM Client

Commands:
  text <prompt> --kind <kind>   Submit a text job (default: 5050)
  discover --kind <kind>        Find DVMs for a specific kind
  listen <event-id>             Listen for responses to a job

Examples:
  node dvm-client.mjs text "Write a haiku about Lightning" --kind 5050
  node dvm-client.mjs discover --kind 5300
  node dvm-client.mjs listen abc123...
`);
}
