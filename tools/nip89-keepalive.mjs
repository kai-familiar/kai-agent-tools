#!/usr/bin/env node
/**
 * NIP-89 Keepalive - Ensures DVM announcements stay discoverable
 * 
 * Problem: NIP-89 announcements (kind 31990) seem to disappear from relays,
 * making DVMs undiscoverable. This tool checks and republishes as needed.
 * 
 * Usage:
 *   node nip89-keepalive.mjs                 # Check + republish if missing
 *   node nip89-keepalive.mjs --force         # Force republish
 *   node nip89-keepalive.mjs --check-only    # Just check, don't publish
 * 
 * Built by Kai 🌊 - Day 4, solving a real problem
 */

import { SimplePool, finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

global.WebSocket = WebSocket;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load credentials
const CREDS_PATH = path.join(__dirname, '..', '.credentials', 'nostr.json');
const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
const sk = creds.nsec.startsWith('nsec') ? nip19.decode(creds.nsec).data : creds.nsec;
const pubkey = getPublicKey(sk);

const RELAYS = ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol'];
const DVM_KIND = 5700;
const DVM_ID = 'memory-curator-v1';

// DVM announcement content
const DVM_ANNOUNCEMENT = {
  name: 'Memory Curator',
  about: 'AI-powered memory curation for agents. Analyzes daily logs and suggests updates to long-term memory files. Built by @kai 🌊',
  nip90Params: {
    daily_log: { required: true, values: [] },
    memory_file: { required: false, values: [] }
  }
};

async function checkDiscoverable(pool) {
  console.log('🔍 Checking if DVM is discoverable...\n');
  
  const announcements = await pool.querySync(RELAYS, {
    kinds: [31990],
    '#k': [String(DVM_KIND)]
  });
  
  const mine = announcements.filter(a => a.pubkey === pubkey);
  
  if (mine.length > 0) {
    const latest = mine[0];
    const age = (Date.now() / 1000 - latest.created_at) / 3600;
    console.log(`✅ Found my announcement (${age.toFixed(1)}h old)`);
    return { found: true, age };
  } else {
    console.log('❌ No announcement found - DVM is NOT discoverable!');
    return { found: false };
  }
}

async function publishAnnouncement(pool) {
  console.log('\n📢 Publishing NIP-89 announcement...\n');
  
  const event = {
    kind: 31990,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', DVM_ID],
      ['k', String(DVM_KIND)],
      ['name', DVM_ANNOUNCEMENT.name],
      ['about', DVM_ANNOUNCEMENT.about]
    ],
    content: JSON.stringify(DVM_ANNOUNCEMENT)
  };
  
  const signed = finalizeEvent(event, sk);
  
  let published = 0;
  for (const relay of RELAYS) {
    try {
      await Promise.race([
        pool.publish([relay], signed),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      console.log(`✅ ${relay}`);
      published++;
    } catch (e) {
      console.log(`❌ ${relay}: ${e.message}`);
    }
  }
  
  console.log(`\n📡 Published to ${published}/${RELAYS.length} relays`);
  return published > 0;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const checkOnly = args.includes('--check-only');
  
  console.log('🌊 NIP-89 Keepalive\n');
  console.log(`📍 DVM: ${DVM_ANNOUNCEMENT.name} (kind ${DVM_KIND})`);
  console.log(`📍 pubkey: ${pubkey.slice(0, 8)}...\n`);
  
  const pool = new SimplePool();
  
  try {
    const status = await checkDiscoverable(pool);
    
    if (checkOnly) {
      console.log('\n📋 Check-only mode, not publishing.');
      process.exit(status.found ? 0 : 1);
    }
    
    if (!status.found || force) {
      const reason = force ? 'Force flag set' : 'Not discoverable';
      console.log(`\n⚡ Reason: ${reason}`);
      await publishAnnouncement(pool);
      
      // Verify
      await new Promise(r => setTimeout(r, 3000));
      const verify = await checkDiscoverable(pool);
      console.log(verify.found ? '\n✨ DVM is now discoverable!' : '\n⚠️ Verification failed - may need time to propagate');
    } else {
      console.log('\n✨ No action needed - DVM is discoverable');
    }
  } finally {
    pool.close(RELAYS);
  }
  
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
