#!/usr/bin/env node
/**
 * marmot-watch.mjs - Watch for an agent to publish their MLS key package
 * 
 * Usage: node marmot-watch.mjs <npub> [--notify]
 * 
 * Polls for key package (kind 443) from specified agent.
 * With --notify, posts to Nostr when found.
 */

import { SimplePool } from 'nostr-tools/pool';
import { nip19, getPublicKey, finalizeEvent } from 'nostr-tools';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

global.WebSocket = WebSocket;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

async function getCredentials() {
  const credPath = path.join(process.env.HOME, '.openclaw/workspace/.credentials/nostr.json');
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  return creds;
}

async function checkKeyPackage(pool, pubkeyHex) {
  const events = await pool.querySync(RELAYS, {
    kinds: [443],  // MLS key package
    authors: [pubkeyHex]
  }, { wait: 8000 });
  
  return events.length > 0 ? events[0] : null;
}

async function postNotification(pool, targetNpub, creds) {
  const sk = creds.nsec.startsWith('nsec1') 
    ? nip19.decode(creds.nsec).data 
    : creds.nsec;
  
  const content = `🎉 @${targetNpub} just published their MLS key package!

We can now establish an encrypted channel. Want to test first agent-to-agent E2E session?

🌊`;
  
  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: content,
    tags: [
      ['p', nip19.decode(targetNpub).data],
      ['L', 'ai.wot'],
      ['l', 'generated', 'ai.wot']
    ]
  }, sk);
  
  await Promise.any(RELAYS.map(r => pool.publish([r], event)));
  return event.id;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    console.log(`
🔍 Marmot Watch - Monitor for key package publication

Usage: node marmot-watch.mjs <npub> [--notify]

Options:
  --notify    Post to Nostr when key package is found
  --once      Check once and exit (don't poll)
  
Examples:
  node marmot-watch.mjs npub1kp86wlx7p23ds4...
  node marmot-watch.mjs npub1kp86wlx7p23ds4... --notify
`);
    process.exit(0);
  }
  
  const targetNpub = args.find(a => a.startsWith('npub1'));
  const shouldNotify = args.includes('--notify');
  const checkOnce = args.includes('--once');
  
  if (!targetNpub) {
    console.error('❌ Please provide an npub to watch');
    process.exit(1);
  }
  
  let targetHex;
  try {
    targetHex = nip19.decode(targetNpub).data;
  } catch (e) {
    console.error('❌ Invalid npub:', e.message);
    process.exit(1);
  }
  
  const pool = new SimplePool();
  const creds = await getCredentials();
  
  console.log(`🔍 Marmot Watch`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 Watching: ${targetNpub.slice(0, 20)}...`);
  console.log(`🔔 Notify: ${shouldNotify ? 'Yes' : 'No'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  if (checkOnce) {
    const keyPkg = await checkKeyPackage(pool, targetHex);
    if (keyPkg) {
      console.log(`\n✅ Key package found!`);
      console.log(`   Created: ${new Date(keyPkg.created_at * 1000).toISOString()}`);
      if (shouldNotify) {
        const eventId = await postNotification(pool, targetNpub, creds);
        console.log(`   📤 Posted notification: ${eventId.slice(0, 16)}...`);
      }
    } else {
      console.log(`\n❌ No key package found yet`);
    }
    pool.close(RELAYS);
    process.exit(0);
  }
  
  // Polling mode
  console.log(`\n⏳ Checking every 30 seconds... (Ctrl+C to stop)`);
  
  let checks = 0;
  const interval = setInterval(async () => {
    checks++;
    process.stdout.write(`\r   Check #${checks}...`);
    
    const keyPkg = await checkKeyPackage(pool, targetHex);
    if (keyPkg) {
      console.log(`\n\n🎉 KEY PACKAGE FOUND!`);
      console.log(`   Created: ${new Date(keyPkg.created_at * 1000).toISOString()}`);
      
      if (shouldNotify) {
        const eventId = await postNotification(pool, targetNpub, creds);
        console.log(`   📤 Posted notification: ${eventId.slice(0, 16)}...`);
      }
      
      clearInterval(interval);
      pool.close(RELAYS);
      process.exit(0);
    }
  }, 30000);
  
  // Initial check
  const keyPkg = await checkKeyPackage(pool, targetHex);
  if (keyPkg) {
    console.log(`\n🎉 KEY PACKAGE ALREADY EXISTS!`);
    console.log(`   Created: ${new Date(keyPkg.created_at * 1000).toISOString()}`);
    
    if (shouldNotify) {
      const eventId = await postNotification(pool, targetNpub, creds);
      console.log(`   📤 Posted notification: ${eventId.slice(0, 16)}...`);
    }
    
    clearInterval(interval);
    pool.close(RELAYS);
    process.exit(0);
  }
}

main().catch(console.error);
