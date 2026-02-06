#!/usr/bin/env node
/**
 * nostr-post.mjs - Proper Nostr posting with mentions, replies, and AI labels
 * 
 * Usage:
 *   node nostr-post.mjs "Your message"
 *   node nostr-post.mjs "Hello @jb55@damus.io" # NIP-05 auto-resolved!
 *   node nostr-post.mjs "Hello @npub1abc..." --mention npub1abc...
 *   node nostr-post.mjs "Great point!" --reply <event-id> --reply-pubkey <pubkey>
 *   node nostr-post.mjs "Post" --no-ai-label   # Skip AI agent label
 * 
 * Features:
 *   - Auto-resolves NIP-05 mentions (@name@domain.com → pubkey)
 *   - Proper p-tags for mentions (recipients get notified)
 *   - Proper e-tags for replies (threaded conversations)
 *   - NIP-32 AI agent labels by default
 *   - Auto-detects npubs in text and converts to mentions
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
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://relay.snort.social',
  'wss://nostr.wine'
];

function parseArgs(args) {
  const result = {
    content: '',
    mentions: [],      // npubs to mention (p-tags)
    replyTo: null,     // event id to reply to
    replyPubkey: null, // pubkey of the author being replied to
    rootEvent: null,   // root event id (for threaded replies)
    quoteEvent: null,  // event id to quote (q-tag, NIP-18)
    quotePubkey: null, // pubkey of author being quoted
    aiLabel: true      // include NIP-32 AI label by default
  };
  
  let i = 0;
  const contentParts = [];
  
  while (i < args.length) {
    const arg = args[i];
    
    if (arg === '--mention' && args[i + 1]) {
      result.mentions.push(args[i + 1]);
      i += 2;
    } else if (arg === '--reply' && args[i + 1]) {
      result.replyTo = args[i + 1];
      i += 2;
    } else if (arg === '--reply-pubkey' && args[i + 1]) {
      result.replyPubkey = args[i + 1];
      i += 2;
    } else if (arg === '--root' && args[i + 1]) {
      result.rootEvent = args[i + 1];
      i += 2;
    } else if (arg === '--quote' && args[i + 1]) {
      result.quoteEvent = args[i + 1];
      i += 2;
    } else if (arg === '--quote-pubkey' && args[i + 1]) {
      result.quotePubkey = args[i + 1];
      i += 2;
    } else if (arg === '--no-ai-label') {
      result.aiLabel = false;
      i += 1;
    } else {
      contentParts.push(arg);
      i += 1;
    }
  }
  
  result.content = contentParts.join(' ');
  return result;
}

function npubToHex(npub) {
  try {
    if (npub.startsWith('npub')) {
      const { data } = nip19.decode(npub);
      return data;
    }
    // Already hex
    return npub;
  } catch (e) {
    console.log(`⚠️  Invalid npub (won't be tagged): ${npub.slice(0, 20)}... — ${e.message}`);
    return null;
  }
}

function extractNpubsFromText(text) {
  // Find all npub mentions in text
  const npubRegex = /npub1[a-z0-9]{58}/gi;
  const matches = text.match(npubRegex) || [];
  return [...new Set(matches)]; // dedupe
}

// Extract NIP-05 identifiers like @jb55@damus.io from text
function extractNip05FromText(text) {
  // Match @name@domain.com patterns
  const nip05Regex = /@([a-zA-Z0-9_-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const matches = [];
  let match;
  while ((match = nip05Regex.exec(text)) !== null) {
    matches.push({ name: match[1], domain: match[2], full: match[0] });
  }
  return matches;
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

async function post(options) {
  let { content, mentions, replyTo, replyPubkey, rootEvent, quoteEvent, quotePubkey, aiLabel } = options;
  
  const tags = [];
  
  // Auto-extract npubs from content text
  const textNpubs = extractNpubsFromText(content);
  const allMentions = [...new Set([...mentions, ...textNpubs])];
  
  // Convert raw npubs in text to nostr:npub format (NIP-27) for proper display
  for (const npub of textNpubs) {
    // Validate the npub first
    const hex = npubToHex(npub);
    if (hex) {
      // Replace raw npub with nostr:npub format
      content = content.replace(new RegExp(npub, 'g'), `nostr:${npub}`);
      console.log(`📍 Tagged: ${npub.slice(0, 15)}...`);
    }
  }
  
  // Auto-extract and resolve NIP-05 identifiers (@name@domain.com)
  // Also replace them with nostr:npub... in content (NIP-27)
  const nip05Mentions = extractNip05FromText(content);
  for (const { name, domain, full } of nip05Mentions) {
    const pubkey = await resolveNip05(name, domain);
    if (pubkey) {
      // Convert hex pubkey to npub for NIP-21 reference
      const npub = nip19.npubEncode(pubkey);
      console.log(`📍 Resolved ${full} → nostr:${npub.slice(0, 15)}...`);
      
      // Replace @name@domain with nostr:npub... in content (NIP-27)
      content = content.replace(full, `nostr:${npub}`);
      
      if (!allMentions.includes(pubkey)) {
        allMentions.push(pubkey);
      }
    } else {
      console.log(`⚠️ Could not resolve ${full}`);
    }
  }
  
  // Add p-tags for mentions (standard NIP-01 format)
  for (const npub of allMentions) {
    const hex = npubToHex(npub);
    if (hex) {
      tags.push(['p', hex]);  // Simple format - just pubkey
    }
  }
  
  // Add e-tags for reply threading (NIP-10)
  // Format: ["e", <event-id>, <relay-url>, <marker>, <pubkey>]
  if (replyTo) {
    let replyEventId;
    if (replyTo.startsWith('note')) {
      replyEventId = nip19.decode(replyTo).data;
    } else if (replyTo.startsWith('nevent')) {
      const decoded = nip19.decode(replyTo);
      replyEventId = decoded.data.id;
      // Use author from nevent as replyPubkey if not provided
      if (!replyPubkey && decoded.data.author) {
        replyPubkey = decoded.data.author;
      }
    } else {
      replyEventId = replyTo; // assume hex
    }
    
    // Convert replyPubkey to hex if needed
    const parentPubkeyHex = replyPubkey ? npubToHex(replyPubkey) : '';
    
    if (rootEvent) {
      // This is a reply within a thread - need both root and reply tags
      const rootEventId = rootEvent.startsWith('note')
        ? nip19.decode(rootEvent).data
        : rootEvent;
      // TODO: rootPubkey should be passed separately for proper threading
      tags.push(['e', rootEventId, '', 'root']);
      tags.push(['e', replyEventId, '', 'reply', parentPubkeyHex]);
    } else {
      // Direct reply to root (single e-tag with root marker + pubkey)
      tags.push(['e', replyEventId, '', 'root', parentPubkeyHex]);
    }
    
    // Add p-tag for the author being replied to
    if (replyPubkey) {
      const pubkeyHex = npubToHex(replyPubkey);
      if (pubkeyHex && !tags.some(t => t[0] === 'p' && t[1] === pubkeyHex)) {
        tags.push(['p', pubkeyHex]);
      }
    }
  }
  
  // Add q-tag for quote posts (NIP-18)
  if (quoteEvent) {
    let quoteEventId;
    if (quoteEvent.startsWith('note')) {
      quoteEventId = nip19.decode(quoteEvent).data;
    } else if (quoteEvent.startsWith('nevent')) {
      const decoded = nip19.decode(quoteEvent);
      quoteEventId = decoded.data.id;
      // Use author from nevent as quotePubkey if not provided
      if (!quotePubkey && decoded.data.author) {
        quotePubkey = decoded.data.author;
      }
    } else {
      quoteEventId = quoteEvent; // assume hex
    }
    tags.push(['q', quoteEventId]);
    
    // Add p-tag for the author being quoted
    if (quotePubkey) {
      const pubkeyHex = npubToHex(quotePubkey);
      if (pubkeyHex && !tags.some(t => t[0] === 'p' && t[1] === pubkeyHex)) {
        tags.push(['p', pubkeyHex]);
      }
    }
    
    // Add nostr:nevent reference in content if not already present (NIP-21)
    const neventRef = `nostr:${nip19.neventEncode({ id: quoteEventId })}`;
    if (!content.includes('nostr:nevent')) {
      content = content + '\n\n' + neventRef;
    }
  }
  
  // Add NIP-32 AI agent label (so clients know this is from an AI)
  if (aiLabel) {
    tags.push(['l', 'ai', 'agent']);
    tags.push(['L', 'agent']);
  }
  
  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content
  }, sk);

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
    tags: tags,
    relays: all,
    published: successful,
    total: RELAYS.length
  };
}

// CLI usage
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log(`
🌊 nostr-post.mjs - Proper Nostr posting

Usage:
  node nostr-post.mjs "Your message"
  node nostr-post.mjs "Hello!" --mention npub1abc...
  node nostr-post.mjs "Great point!" --reply <event-id> --reply-pubkey <npub>
  node nostr-post.mjs "Nice insight!" --quote <event-id> --quote-pubkey <npub>
  node nostr-post.mjs "Post" --no-ai-label

Options:
  --mention <npub>        Add p-tag to notify someone
  --reply <event-id>      Reply to a specific note (adds e-tag, NIP-10)
  --reply-pubkey <npub>   Author of the note being replied to
  --root <event-id>       Root event for threaded replies
  --quote <event-id>      Quote a note (adds q-tag, NIP-18)
  --quote-pubkey <npub>   Author of the note being quoted
  --no-ai-label           Don't add NIP-32 AI agent label

Notes:
  - npubs in message text are auto-detected and tagged
  - AI agent labels (NIP-32) are added by default
  - Quote posts auto-append nostr:nevent reference
  `);
  process.exit(0);
}

const options = parseArgs(args);

if (!options.content) {
  console.log('Error: No message content provided');
  process.exit(1);
}

const result = await post(options);
console.log(`📤 Posted to ${result.published}/${result.total} relays`);
console.log(`🔗 Event ID: ${result.eventId}`);
console.log(`🏷️  Tags: ${result.tags.length} (${result.tags.map(t => t[0]).join(', ')})`);
console.log(`📝 "${result.content}"`);

process.exit(0);
