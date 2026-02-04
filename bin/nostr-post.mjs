#!/usr/bin/env node
/**
 * nostr-post.mjs - Simple CLI for posting to Nostr
 * Usage: node tools/nostr-post.mjs "Your message here"
 * 
 * Kai's Nostr posting utility 🌊
 */

import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(__dirname, '..');

// Load credentials
const creds = JSON.parse(readFileSync(join(workspaceDir, '.credentials/nostr.json')));
const sk = Uint8Array.from(Buffer.from(creds.privateKeyHex, 'hex'));

// Default relays
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

async function post(content, tags = []) {
  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  }, sk);

  const results = [];
  const promises = RELAYS.map(url => new Promise((resolve) => {
    try {
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ relay: url, ok: false, error: 'timeout' });
      }, 5000);

      ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
      ws.on('message', (data) => {
        clearTimeout(timeout);
        const [type, id, ok, msg] = JSON.parse(data.toString());
        ws.close();
        resolve({ relay: url, ok, message: msg });
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ relay: url, ok: false, error: err.message });
      });
    } catch (e) {
      resolve({ relay: url, ok: false, error: e.message });
    }
  }));

  const all = await Promise.all(promises);
  const successful = all.filter(r => r.ok).length;
  
  return {
    eventId: event.id,
    npub: creds.npub,
    content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
    relays: all,
    published: successful,
    total: RELAYS.length
  };
}

// CLI usage
const message = process.argv.slice(2).join(' ');
if (!message) {
  console.log('Usage: node tools/nostr-post.mjs "Your message"');
  process.exit(1);
}

const result = await post(message);
console.log(`📤 Posted to ${result.published}/${result.total} relays`);
console.log(`🔗 Event ID: ${result.eventId}`);
console.log(`📝 "${result.content}"`);

process.exit(0);
