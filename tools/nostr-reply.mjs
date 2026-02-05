#!/usr/bin/env node
/**
 * nostr-reply.mjs - Reply to a Nostr post with proper NIP-10 threading
 * 
 * Usage:
 *   node nostr-reply.mjs <nevent|note|event-id> "Your reply message"
 *   node nostr-reply.mjs nevent1qy28wumn... "Great point!"
 *   node nostr-reply.mjs note1abc... "I agree!"
 * 
 * Automatically:
 *   - Decodes nevent/note to get event ID
 *   - Fetches the original event to get author pubkey
 *   - Creates proper NIP-10 threaded reply with e-tag and p-tag
 *   - Resolves @name@domain.com mentions (NIP-05 → NIP-27)
 *   - Adds NIP-32 AI agent label
 * 
 * Kai's reply tool 🌊
 */

import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Polyfill WebSocket for nostr-tools
global.WebSocket = WebSocket;

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(__dirname, '..');

// Load credentials
const creds = JSON.parse(readFileSync(join(workspaceDir, '.credentials/nostr.json')));
const sk = Uint8Array.from(Buffer.from(creds.privateKeyHex, 'hex'));

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://relay.snort.social',
  'wss://nostr.wine'
];

// Decode nevent/note/hex to event ID and optional relay hints
function decodeEventRef(ref) {
  try {
    if (ref.startsWith('nevent')) {
      const decoded = nip19.decode(ref);
      return {
        id: decoded.data.id,
        relays: decoded.data.relays || [],
        author: decoded.data.author || null
      };
    } else if (ref.startsWith('note')) {
      const decoded = nip19.decode(ref);
      return { id: decoded.data, relays: [], author: null };
    } else if (/^[0-9a-f]{64}$/i.test(ref)) {
      return { id: ref, relays: [], author: null };
    }
  } catch (e) {
    console.error(`Failed to decode: ${ref}`);
  }
  return null;
}

// Fetch event from relays to get author pubkey
async function fetchEvent(eventId, relayHints = []) {
  const pool = new SimplePool();
  const relaysToTry = [...new Set([...relayHints, ...RELAYS.slice(0, 3)])];
  
  try {
    const event = await pool.get(relaysToTry, { ids: [eventId] });
    pool.close(relaysToTry);
    return event;
  } catch (e) {
    pool.close(relaysToTry);
    return null;
  }
}

// Resolve NIP-05 identifier to hex pubkey
async function resolveNip05(name, domain) {
  try {
    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data.names?.[name] || null;
  } catch {
    return null;
  }
}

// Extract and resolve NIP-05 mentions, return updated content and pubkeys
async function processNip05Mentions(content) {
  const nip05Regex = /@([a-zA-Z0-9_-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const pubkeys = [];
  let match;
  let newContent = content;
  
  const matches = [];
  while ((match = nip05Regex.exec(content)) !== null) {
    matches.push({ name: match[1], domain: match[2], full: match[0] });
  }
  
  for (const { name, domain, full } of matches) {
    const pubkey = await resolveNip05(name, domain);
    if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      console.log(`📍 Resolved ${full} → nostr:${npub.slice(0, 15)}...`);
      newContent = newContent.replace(full, `nostr:${npub}`);
      pubkeys.push(pubkey);
    }
  }
  
  return { content: newContent, pubkeys };
}

async function reply(eventRef, message) {
  // Decode the event reference
  const decoded = decodeEventRef(eventRef);
  if (!decoded) {
    console.error('❌ Could not decode event reference');
    console.error('   Supported formats: nevent1..., note1..., or 64-char hex ID');
    process.exit(1);
  }
  
  console.log(`🔍 Replying to event: ${decoded.id.slice(0, 12)}...`);
  
  // Fetch the original event to get author pubkey
  let authorPubkey = decoded.author;
  if (!authorPubkey) {
    console.log('📡 Fetching original event...');
    const event = await fetchEvent(decoded.id, decoded.relays);
    if (event) {
      authorPubkey = event.pubkey;
      console.log(`✅ Found author: ${authorPubkey.slice(0, 12)}...`);
    } else {
      console.error('⚠️ Could not fetch original event, proceeding without author pubkey');
    }
  }
  
  // Process NIP-05 mentions in the message
  const { content, pubkeys: mentionPubkeys } = await processNip05Mentions(message);
  
  // Build tags
  const tags = [];
  
  // NIP-10: e-tag for reply threading
  // Format: ["e", <event-id>, <relay-url>, "root", <pubkey>]
  const relayHint = decoded.relays[0] || '';
  if (authorPubkey) {
    tags.push(['e', decoded.id, relayHint, 'root', authorPubkey]);
  } else {
    tags.push(['e', decoded.id, relayHint, 'root']);
  }
  
  // p-tag for author notification
  if (authorPubkey) {
    tags.push(['p', authorPubkey]);
  }
  
  // p-tags for any NIP-05 mentions
  for (const pubkey of mentionPubkeys) {
    if (pubkey !== authorPubkey) {
      tags.push(['p', pubkey]);
    }
  }
  
  // NIP-32: AI agent label
  tags.push(['l', 'ai', 'agent']);
  tags.push(['L', 'agent']);
  
  // Create and sign the event
  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  }, sk);
  
  // Publish to relays
  console.log('📤 Publishing reply...');
  const results = await Promise.all(RELAYS.map(url => 
    new Promise(resolve => {
      try {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ relay: url, ok: false });
        }, 5000);
        
        ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
        ws.on('message', (data) => {
          clearTimeout(timeout);
          const [, , ok] = JSON.parse(data.toString());
          ws.close();
          resolve({ relay: url, ok });
        });
        ws.on('error', () => {
          clearTimeout(timeout);
          resolve({ relay: url, ok: false });
        });
      } catch {
        resolve({ relay: url, ok: false });
      }
    })
  ));
  
  const successful = results.filter(r => r.ok).length;
  console.log(`📤 Posted to ${successful}/${RELAYS.length} relays`);
  console.log(`🔗 Event ID: ${event.id}`);
  console.log(`📝 "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`);
  
  if (successful === 0) {
    console.error('❌ Failed to publish to any relay');
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node nostr-reply.mjs <nevent|note|event-id> "Your reply"');
  console.log('');
  console.log('Examples:');
  console.log('  node nostr-reply.mjs nevent1qy28wumn... "Great point!"');
  console.log('  node nostr-reply.mjs note1abc... "I agree with @jb55@damus.io"');
  process.exit(1);
}

const eventRef = args[0];
const message = args.slice(1).join(' ');

reply(eventRef, message).catch(console.error);
