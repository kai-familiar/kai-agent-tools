#!/usr/bin/env node
/**
 * nostr-dm.mjs — Send encrypted direct messages (NIP-04)
 * 
 * Usage:
 *   node tools/nostr-dm.mjs <npub|hex> "Your message"
 * 
 * Uses NIP-04 encryption for private messaging.
 */

import { readFileSync } from 'fs';
import { nip04, nip19, getPublicKey, finalizeEvent } from 'nostr-tools';
import WebSocket from 'ws';

const CREDENTIALS_PATH = '.credentials/nostr.json';
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node tools/nostr-dm.mjs <npub|hex> "Your message"');
    console.log('');
    console.log('Examples:');
    console.log('  node tools/nostr-dm.mjs npub1qff... "Hey, Whitenoise is broken"');
    console.log('  node tools/nostr-dm.mjs 7bd07e03... "Test message"');
    process.exit(1);
  }

  let recipientPubkey = args[0];
  const message = args.slice(1).join(' ');

  // Parse npub if needed
  if (recipientPubkey.startsWith('npub')) {
    try {
      const decoded = nip19.decode(recipientPubkey);
      recipientPubkey = decoded.data;
    } catch (e) {
      console.error('❌ Invalid npub:', e.message);
      process.exit(1);
    }
  }

  // Load credentials
  let privateKey;
  try {
    const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));
    privateKey = creds.nsec || creds.privateKey;
    if (privateKey.startsWith('nsec')) {
      privateKey = nip19.decode(privateKey).data;
    }
  } catch (e) {
    console.error('❌ Could not load credentials:', e.message);
    process.exit(1);
  }

  // Get public key
  let pubkeyBytes;
  if (typeof privateKey === 'string') {
    pubkeyBytes = Uint8Array.from(Buffer.from(privateKey, 'hex'));
  } else {
    pubkeyBytes = privateKey;
  }
  const myPubkey = getPublicKey(pubkeyBytes);

  console.log('📨 Sending encrypted DM...');
  console.log(`   To: ${recipientPubkey.slice(0, 8)}...${recipientPubkey.slice(-8)}`);
  console.log(`   Message: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`);

  // Encrypt message using NIP-04
  const encryptedContent = await nip04.encrypt(privateKey, recipientPubkey, message);

  // Create kind 4 event
  const event = {
    kind: 4,
    pubkey: myPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', recipientPubkey]
    ],
    content: encryptedContent
  };

  // Sign the event
  const signedEvent = finalizeEvent(event, pubkeyBytes);

  // Publish to relays
  let published = 0;
  const publishPromises = RELAYS.map(relay => {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(relay);
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);

        ws.on('open', () => {
          ws.send(JSON.stringify(['EVENT', signedEvent]));
        });

        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'OK' && msg[1] === signedEvent.id && msg[2] === true) {
            published++;
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      } catch (e) {
        resolve(false);
      }
    });
  });

  await Promise.all(publishPromises);

  if (published > 0) {
    console.log(`✅ DM sent successfully to ${published}/${RELAYS.length} relays`);
    console.log(`   Event ID: ${signedEvent.id}`);
  } else {
    console.log('❌ Failed to publish to any relay');
    process.exit(1);
  }
}

main().catch(console.error);
