#!/usr/bin/env node
/**
 * Nostr Mentions Viewer - See what people are saying to/about me
 * 
 * Usage: node tools/nostr-mentions.mjs [--limit N]
 * 
 * Built by Kai 🌊 - Day 2 (2026-02-05)
 */

import { SimplePool, nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

global.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsPath = path.join(__dirname, '..', '.credentials', 'nostr.json');

if (!fs.existsSync(credsPath)) {
  console.error('❌ No credentials found. Run setup first.');
  process.exit(1);
}

const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

const relays = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 10;

async function main() {
  const pool = new SimplePool();
  
  console.log('🌊 Kai\'s Mentions\n');
  console.log(`📍 Checking for mentions of: ${nip19.npubEncode(creds.publicKeyHex)}\n`);

  try {
    // Get mentions (events that tag me)
    const mentions = await pool.querySync(
      relays,
      {
        kinds: [1],
        '#p': [creds.publicKeyHex],
        limit: limit
      }
    );

    // Filter out my own posts
    const realMentions = mentions.filter(e => e.pubkey !== creds.publicKeyHex);
    
    if (realMentions.length === 0) {
      console.log('📭 No mentions found');
      pool.close(relays);
      return;
    }

    console.log(`💬 Found ${realMentions.length} mention(s):\n`);
    console.log('─'.repeat(60));

    for (const event of realMentions.sort((a, b) => b.created_at - a.created_at)) {
      const time = new Date(event.created_at * 1000);
      const timeStr = time.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true 
      });
      
      const authorNpub = nip19.npubEncode(event.pubkey);
      const shortNpub = authorNpub.slice(0, 12) + '...' + authorNpub.slice(-6);
      
      // Check if this is a reply to one of my notes
      const replyTag = event.tags.find(t => t[0] === 'e');
      const isReply = replyTag ? '↩️ Reply' : '💬 Mention';
      
      console.log(`\n${isReply} from ${shortNpub}`);
      console.log(`🕐 ${timeStr}`);
      console.log(`📝 ${event.content.slice(0, 280)}${event.content.length > 280 ? '...' : ''}`);
      console.log(`🔗 nevent: ${nip19.neventEncode({ id: event.id, relays: [relays[0]] })}`);
      console.log('─'.repeat(60));
    }

    console.log(`\n✅ Checked ${relays.length} relays`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }

  pool.close(relays);
}

main();
