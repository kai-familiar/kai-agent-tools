#!/usr/bin/env node
/**
 * NIP-46 Remote Signer for Kai 🌊
 * Allows remote apps to request signatures without exposing nsec
 */

import { finalizeEvent } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import * as nip04 from 'nostr-tools/nip04';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';

const creds = JSON.parse(readFileSync(new URL('../.credentials/nostr.json', import.meta.url)));
const skHex = creds.privateKeyHex;
const sk = Uint8Array.from(Buffer.from(skHex, 'hex'));
const myPubkey = creds.publicKeyHex;

// Use provided secret or generate new one
const secret = process.argv[2] || '17f3163048623cb609ec1a8cbfab542af39a5226574e0f511850ce4d586204ce';
const relayUrl = 'wss://relay.damus.io';

console.log('=== NIP-46 Remote Signer for Kai 🌊 ===\n');
console.log('Bunker URL:');
console.log(`bunker://${myPubkey}?relay=${encodeURIComponent(relayUrl)}&secret=${secret}`);
console.log('\nConnecting to relay...\n');

const relay = await Relay.connect(relayUrl);
console.log('✅ Connected to', relayUrl);
console.log('🔐 Listening for signing requests...\n');

relay.subscribe([
  { kinds: [24133], '#p': [myPubkey] }
], {
  onevent: async (event) => {
    console.log(`[${new Date().toLocaleTimeString()}] 📥 Request from: ${event.pubkey.substring(0, 12)}...`);
    
    try {
      const decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
      const request = JSON.parse(decrypted);
      console.log(`  Method: ${request.method}`);
      
      let result;
      
      switch (request.method) {
        case 'connect':
          result = 'ack';
          break;
        case 'get_public_key':
          result = myPubkey;
          break;
        case 'sign_event':
          // Handle event as string or object
          let eventToSign = request.params[0];
          if (typeof eventToSign === 'string') {
            eventToSign = JSON.parse(eventToSign);
          }
          const signed = finalizeEvent(eventToSign, sk);
          result = JSON.stringify(signed);
          console.log(`  Signed kind ${eventToSign.kind}`);
          break;
        case 'nip04_encrypt':
          result = await nip04.encrypt(sk, request.params[0], request.params[1]);
          break;
        case 'nip04_decrypt':
          result = await nip04.decrypt(sk, request.params[0], request.params[1]);
          break;
        default:
          result = { error: 'Unknown method' };
      }
      
      const response = { id: request.id, result };
      const encryptedResponse = await nip04.encrypt(sk, event.pubkey, JSON.stringify(response));
      
      const responseEvent = finalizeEvent({
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', event.pubkey]],
        content: encryptedResponse
      }, sk);
      
      await relay.publish(responseEvent);
      console.log(`  ✅ Responded\n`);
      
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }
});

// Keep alive
setInterval(() => {}, 1000);
