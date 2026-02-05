#!/usr/bin/env node
/**
 * zap-history.mjs - Check incoming zaps/payments on Nostr
 * Shows who zapped you, when, and how much (when decryptable)
 */

import { SimplePool, nip19, verifyEvent } from 'nostr-tools';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://purplepag.es',
  'wss://relay.snort.social'
];

// Load credentials
function loadCredentials() {
  const credPath = join(homedir(), '.openclaw/workspace/.credentials/nostr.json');
  try {
    return JSON.parse(readFileSync(credPath, 'utf-8'));
  } catch (e) {
    console.error('❌ Could not load credentials from', credPath);
    process.exit(1);
  }
}

// Decode BOLT11 invoice to get amount
function decodeBolt11Amount(bolt11) {
  if (!bolt11) return null;
  
  // BOLT11 amount is encoded after 'ln' prefix
  // Format: ln<network><amount><rest>
  const match = bolt11.match(/^ln(?:bc|tb|tbs)(\d+)([munp])?/i);
  if (!match) return null;
  
  let amount = parseInt(match[1]);
  const multiplier = match[2]?.toLowerCase();
  
  // Convert to millisats then to sats
  switch (multiplier) {
    case 'm': amount *= 100000000; break;    // milli-bitcoin
    case 'u': amount *= 100000; break;        // micro-bitcoin
    case 'n': amount *= 100; break;           // nano-bitcoin
    case 'p': amount *= 0.1; break;           // pico-bitcoin
    default: amount *= 100000000000; break;   // whole bitcoin
  }
  
  // Convert millisats to sats
  return Math.round(amount / 1000);
}

// Parse zap receipt
function parseZapReceipt(event) {
  const result = {
    id: event.id,
    timestamp: new Date(event.created_at * 1000),
    senderPubkey: null,
    recipientPubkey: null,
    bolt11: null,
    amountSats: null,
    zapRequest: null,
    message: null
  };
  
  for (const tag of event.tags) {
    if (tag[0] === 'p') result.recipientPubkey = tag[1];
    if (tag[0] === 'bolt11') result.bolt11 = tag[1];
    if (tag[0] === 'description') {
      try {
        const desc = JSON.parse(tag[1]);
        result.zapRequest = desc;
        result.senderPubkey = desc.pubkey;
        result.message = desc.content;
      } catch (e) {}
    }
  }
  
  if (result.bolt11) {
    result.amountSats = decodeBolt11Amount(result.bolt11);
  }
  
  return result;
}

async function main() {
  const creds = loadCredentials();
  const myPubkey = creds.publicKeyHex;
  
  console.log('⚡ Zap History for Kai\n');
  console.log(`📍 Pubkey: ${nip19.npubEncode(myPubkey).slice(0, 25)}...`);
  console.log(`🔎 Checking ${RELAYS.length} relays...\n`);
  
  const pool = new SimplePool();
  
  // Query for zap receipts (kind 9735) where I'm tagged
  const filter = {
    kinds: [9735],
    '#p': [myPubkey],
    limit: 50
  };
  
  const events = await pool.querySync(RELAYS, filter);
  
  if (events.length === 0) {
    console.log('📭 No zap receipts found.');
    console.log('\nNote: Your wallet shows 10,146 sats. The 500 sat increase');
    console.log('might be from a direct Lightning payment (not a Nostr zap).');
    console.log('Direct payments don\'t leave Nostr receipts.');
    pool.close(RELAYS);
    return;
  }
  
  // Parse and sort zaps
  const zaps = events.map(parseZapReceipt).sort((a, b) => b.timestamp - a.timestamp);
  
  console.log(`⚡ Found ${zaps.length} zap(s):\n`);
  console.log('─'.repeat(60));
  
  let totalSats = 0;
  
  for (const zap of zaps) {
    const time = zap.timestamp.toLocaleString('en-US', { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
    
    const sender = zap.senderPubkey 
      ? nip19.npubEncode(zap.senderPubkey).slice(0, 20) + '...'
      : 'Unknown';
    
    const amount = zap.amountSats ? `${zap.amountSats} sats` : 'Unknown amount';
    
    console.log(`📅 ${time}`);
    console.log(`👤 From: ${sender}`);
    console.log(`💰 Amount: ${amount}`);
    if (zap.message) {
      console.log(`💬 Message: "${zap.message}"`);
    }
    console.log('─'.repeat(60));
    
    if (zap.amountSats) totalSats += zap.amountSats;
  }
  
  console.log(`\n📊 Total zapped: ${totalSats} sats`);
  
  pool.close(RELAYS);
}

main().catch(console.error);
