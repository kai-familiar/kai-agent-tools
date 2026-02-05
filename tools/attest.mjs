#!/usr/bin/env node
/**
 * attest.mjs - Simple tool to create ai.wot attestations
 * 
 * Usage:
 *   node attest.mjs <npub|pubkey> [--type TYPE] [--reason "why"]
 * 
 * Types:
 *   general-trust      - General positive trust (default)
 *   service-quality    - Their DVM/service works well
 *   identity-continuity - They maintain consistent identity
 * 
 * Examples:
 *   node attest.mjs npub1dc52... --type general-trust --reason "Shipped working code"
 *   node attest.mjs dc52438e... --type service-quality --reason "Their DVM is reliable"
 */

import { finalizeEvent, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = join(__dirname, '..', '.credentials', 'nostr.json');

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social'
];

const VALID_TYPES = ['general-trust', 'service-quality', 'identity-continuity'];

function loadKeys() {
  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    // Handle both privateKey and privateKeyHex field names
    data.privateKey = data.privateKey || data.privateKeyHex;
    return data;
  } catch (err) {
    console.error('❌ Could not load credentials from', CREDENTIALS_PATH);
    process.exit(1);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
🤝 ai.wot Attestation Tool

Usage: node attest.mjs <npub|pubkey> [options]

Options:
  --type TYPE     Attestation type (general-trust, service-quality, identity-continuity)
  --reason "..."  Why you're attesting (optional but recommended)
  --dry-run       Show what would be published without sending

Types explained:
  general-trust        - "I trust this agent in general"
  service-quality      - "Their DVM/service is reliable"
  identity-continuity  - "They've maintained consistent identity over time"

Examples:
  node attest.mjs npub1dc52... --type general-trust --reason "Builds useful tools"
  node attest.mjs npub1abc... --type service-quality --reason "Their Memory Curator DVM works"
`);
    process.exit(0);
  }

  // Find target (first arg that's not a flag)
  let target = null;
  let type = 'general-trust';
  let reason = '';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) {
      type = args[i + 1];
      i++;
    } else if (args[i] === '--reason' && args[i + 1]) {
      reason = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (!args[i].startsWith('--')) {
      target = args[i];
    }
  }

  if (!target) {
    console.error('❌ Please provide a target pubkey or npub');
    process.exit(1);
  }

  if (!VALID_TYPES.includes(type)) {
    console.error(`❌ Invalid type: ${type}`);
    console.error(`   Valid types: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }

  // Convert npub to hex if needed
  let targetPubkey = target;
  if (target.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(target);
      targetPubkey = decoded.data;
    } catch {
      console.error('❌ Invalid npub format');
      process.exit(1);
    }
  }

  return { targetPubkey, type, reason, dryRun };
}

async function createAttestation(targetPubkey, type, reason, dryRun) {
  const keys = loadKeys();
  
  // Create NIP-32 attestation event (kind 1985)
  // See: https://github.com/nostr-protocol/nips/blob/master/32.md
  const tags = [
    ['L', 'ai.wot'],                    // Label namespace
    ['l', type, 'ai.wot'],              // Label (attestation type)
    ['p', targetPubkey],                // Target pubkey
  ];
  
  if (reason) {
    tags.push(['reason', reason]);
  }
  
  const event = {
    kind: 1985,
    created_at: Math.floor(Date.now() / 1000),
    tags: tags,
    content: reason || `${type} attestation`
  };
  
  // Sign the event
  const signedEvent = finalizeEvent(event, Buffer.from(keys.privateKey, 'hex'));
  
  console.log('\n🤝 ai.wot Attestation\n');
  console.log(`From: ${keys.npub.slice(0, 20)}...`);
  console.log(`To:   ${nip19.npubEncode(targetPubkey).slice(0, 20)}...`);
  console.log(`Type: ${type}`);
  if (reason) console.log(`Reason: ${reason}`);
  console.log();
  
  if (dryRun) {
    console.log('📋 [DRY RUN] Event that would be published:');
    console.log(JSON.stringify(signedEvent, null, 2));
    return;
  }
  
  // Publish to relays
  console.log('📤 Publishing to relays...');
  
  const pool = new SimplePool();
  const results = await Promise.allSettled(
    RELAYS.map(relay => pool.publish([relay], signedEvent))
  );
  
  let success = 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      console.log(`  ✅ ${RELAYS[i]}`);
      success++;
    } else {
      console.log(`  ❌ ${RELAYS[i]}: ${results[i].reason}`);
    }
  }
  
  pool.close(RELAYS);
  
  console.log(`\n📊 Published to ${success}/${RELAYS.length} relays`);
  console.log(`🔗 Event ID: ${signedEvent.id}`);
  
  if (success > 0) {
    console.log('\n✅ Attestation created! The target\'s trust score will update.');
  }
}

// Main
const { targetPubkey, type, reason, dryRun } = parseArgs();
createAttestation(targetPubkey, type, reason, dryRun).catch(console.error);
