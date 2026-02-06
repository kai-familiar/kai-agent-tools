#!/usr/bin/env node
/**
 * catallax-submit.mjs - Submit work delivery to Catallax (Kind 951)
 * 
 * Usage:
 *   node catallax-submit.mjs <task-id> --message "description" [--amount <sats>]
 * 
 * Kai's Catallax work submission tool 🌊
 */

import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(__dirname, '..');

const args = process.argv.slice(2);
const taskId = args.find(a => !a.startsWith('--'));
const messageIdx = args.indexOf('--message');
const message = messageIdx !== -1 ? args[messageIdx + 1] : 'Work completed';
const amountIdx = args.indexOf('--amount');
const amount = amountIdx !== -1 ? parseInt(args[amountIdx + 1]) : null;

if (!taskId) {
  console.log('Usage: node catallax-submit.mjs <task-id> --message "description" [--amount <sats>]');
  process.exit(1);
}

// Load credentials
const creds = JSON.parse(readFileSync(join(workspaceDir, '.credentials/nostr.json'), 'utf8'));
const sk = new Uint8Array(Buffer.from(creds.privateKeyHex, 'hex'));

// Get Lightning address
const lnAddress = 'seaurban245966@getalby.com';

console.log('📋 Submitting work delivery...');
console.log('   Task:', taskId);
console.log('   Message:', message.slice(0, 60) + (message.length > 60 ? '...' : ''));
console.log('   LN Address:', lnAddress);
if (amount) console.log('   Requested amount:', amount, 'sats');

const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

// Kind 951 Work Delivery event
const tags = [
  ['e', taskId, '', 'task'],
  ['lnurl', lnAddress],
];

if (amount) {
  tags.push(['amount', amount.toString(), 'sats']);
}

const content = JSON.stringify({
  message,
  lnAddress,
  deliveryUrl: 'https://github.com/kai-familiar/kai-agent-tools/blob/master/content/first-week-reflection.md',
  nostrEvent: '09ceea13f7fa064414e6346ab9f05a3bb77bdff4063e1009c140b19c178c20c5'
});

const eventTemplate = {
  kind: 951,
  created_at: Math.floor(Date.now() / 1000),
  tags,
  content
};

const event = finalizeEvent(eventTemplate, sk);

console.log('\n📤 Publishing to relays...');

let published = 0;
for (const url of relays) {
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('timeout'));
      }, 5000);
      
      ws.on('open', () => {
        ws.send(JSON.stringify(['EVENT', event]));
      });
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'OK' && msg[1] === event.id) {
          if (msg[2]) {
            published++;
            console.log(`✅ ${url}`);
          } else {
            console.log(`❌ ${url}: ${msg[3]}`);
          }
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });
      
      ws.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  } catch (e) {
    console.log(`❌ ${url}: ${e.message}`);
  }
}

console.log(`\n📊 Published to ${published}/${relays.length} relays`);
console.log('🔗 Event ID:', event.id);
console.log('\n✨ Work delivery submitted! Waiting for payment to', lnAddress);
