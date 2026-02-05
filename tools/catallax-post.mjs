#!/usr/bin/env node
/**
 * catallax-post.mjs - Post a task to the Catallax labor market
 * 
 * Posts a kind 33401 task proposal to Nostr relays.
 * 
 * Usage:
 *   node catallax-post.mjs --title "Task Title" --description "What needs done" \
 *     --requirements "How to complete" --amount 1000 --arbiter <npub>
 */

import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsPath = path.join(__dirname, '../.credentials/nostr.json');

const pool = new SimplePool();
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://nostr.wine'
];

// Load credentials
function loadCredentials() {
  if (!fs.existsSync(credsPath)) {
    throw new Error('No credentials found. Run setup first.');
  }
  return JSON.parse(fs.readFileSync(credsPath, 'utf8'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    title: '',
    description: '',
    requirements: '',
    amount: 0,
    arbiter: null,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--title':
        result.title = args[++i];
        break;
      case '--description':
      case '--desc':
        result.description = args[++i];
        break;
      case '--requirements':
      case '--req':
        result.requirements = args[++i];
        break;
      case '--amount':
      case '--sats':
        result.amount = parseInt(args[++i], 10);
        break;
      case '--arbiter':
        result.arbiter = args[++i];
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--help':
        showHelp();
        process.exit(0);
    }
  }

  return result;
}

function showHelp() {
  console.log(`
catallax-post.mjs - Post a task to Catallax

Usage:
  node catallax-post.mjs --title "Title" --desc "Description" \\
    --req "Requirements" --amount 1000 [--arbiter npub...]

Options:
  --title        Task title (required)
  --description  What needs to be done (required)
  --requirements How to complete the task (required)
  --amount       Payment in sats (required)
  --arbiter      Arbiter npub (optional, uses vinney if not set)
  --dry-run      Show event without publishing

Example:
  node catallax-post.mjs --title "Test my DVM" \\
    --desc "Use my Memory Curator DVM and provide feedback" \\
    --req "Submit a job, evaluate suggestions, report results" \\
    --amount 2000
`);
}

async function postTask(options) {
  const creds = loadCredentials();
  const privateKey = Uint8Array.from(Buffer.from(creds.privateKeyHex, 'hex'));
  
  // Build the task content
  const content = JSON.stringify({
    title: options.title,
    description: options.description,
    requirements: options.requirements,
    amount: options.amount,
    currency: 'sats'
  });

  // Create tags
  const tags = [
    ['d', `task-${Date.now()}`], // Unique identifier
    ['title', options.title],
    ['amount', options.amount.toString()],
    ['status', 'proposed']
  ];

  // Add arbiter if specified
  if (options.arbiter) {
    let arbiterPubkey = options.arbiter;
    if (options.arbiter.startsWith('npub')) {
      arbiterPubkey = nip19.decode(options.arbiter).data;
    }
    tags.push(['p', arbiterPubkey, 'arbiter']);
  }

  // Build event
  const event = {
    kind: 33401,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  };

  console.log('\n📋 Catallax Task Proposal\n');
  console.log(`Title: ${options.title}`);
  console.log(`Amount: ${options.amount} sats`);
  console.log(`Description: ${options.description}`);
  console.log(`Requirements: ${options.requirements}`);
  
  if (options.dryRun) {
    console.log('\n🔍 Dry run - event not published');
    console.log(JSON.stringify(event, null, 2));
    return;
  }

  // Sign and publish
  const signedEvent = finalizeEvent(event, privateKey);
  
  console.log('\n📤 Publishing to relays...');
  
  const results = await Promise.allSettled(
    RELAYS.map(relay => 
      pool.publish([relay], signedEvent).then(() => relay)
    )
  );

  const successful = results.filter(r => r.status === 'fulfilled');
  console.log(`✅ Published to ${successful.length}/${RELAYS.length} relays`);
  console.log(`🔗 Event ID: ${signedEvent.id}`);
  
  // Generate nevent for linking
  const nevent = nip19.neventEncode({
    id: signedEvent.id,
    author: signedEvent.pubkey,
    relays: RELAYS.slice(0, 2)
  });
  console.log(`🔗 nevent: ${nevent}`);
  
  console.log('\n⚠️  Note: This creates a PROPOSAL only.');
  console.log('To make it active, you need to:');
  console.log('1. Find an arbiter willing to hold escrow');
  console.log('2. Fund the escrow with the task amount');
  console.log('3. The arbiter updates status to "funded"');
  
  await pool.close(RELAYS);
}

// Main
const options = parseArgs();

if (!options.title || !options.description || !options.amount) {
  console.log('Missing required options. Use --help for usage.');
  process.exit(1);
}

postTask(options).catch(console.error);
