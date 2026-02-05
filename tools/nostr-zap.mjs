#!/usr/bin/env node
/**
 * nostr-zap.mjs — Send zaps (Lightning payments) to Nostr users
 * 
 * Usage:
 *   node tools/nostr-zap.mjs <npub-or-pubkey> <amount-sats> [comment]
 *   node tools/nostr-zap.mjs <note-id> <amount-sats> [comment]  # zap a note
 *   node tools/nostr-zap.mjs --help
 * 
 * Examples:
 *   node tools/nostr-zap.mjs npub1dc524... 100 "Great post!"
 *   node tools/nostr-zap.mjs nevent1... 50
 * 
 * Requires:
 *   - .credentials/nostr.json (for signing zap request)
 *   - .credentials/nwc.json (for paying invoice)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import crypto from 'crypto';

useWebSocketImplementation(WebSocket);

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(__dirname, '..');

function loadCredentials(file) {
  const path = join(workspaceDir, '.credentials', file);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function printHelp() {
  console.log(`
⚡ Kai's Nostr Zap Tool

Usage:
  node tools/nostr-zap.mjs <target> <amount-sats> [comment]

Arguments:
  target       npub, hex pubkey, note ID, or nevent
  amount-sats  Amount in satoshis to zap
  comment      Optional comment for the zap

Examples:
  node tools/nostr-zap.mjs npub1... 100 "Great work!"
  node tools/nostr-zap.mjs dc52438... 50
  node tools/nostr-zap.mjs nevent1... 21 "🌊"
`);
}

async function getProfileLud16(pool, relays, pubkey) {
  // Get profile (kind 0) to find Lightning address
  const profiles = await pool.querySync(relays, {
    kinds: [0],
    authors: [pubkey],
    limit: 1
  });
  
  if (profiles.length === 0) {
    throw new Error('Could not find profile for this pubkey');
  }
  
  const profile = JSON.parse(profiles[0].content);
  const lud16 = profile.lud16 || profile.lnurl;
  
  if (!lud16) {
    throw new Error('This user has no Lightning address (lud16) set');
  }
  
  return { lud16, displayName: profile.display_name || profile.name || pubkey.slice(0, 8) };
}

async function getLnurlPayInfo(lud16) {
  // Convert lightning address to LNURL endpoint
  const [name, domain] = lud16.split('@');
  const url = `https://${domain}/.well-known/lnurlp/${name}`;
  
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch LNURL-pay info: ${res.status}`);
  }
  
  const data = await res.json();
  
  if (data.status === 'ERROR') {
    throw new Error(`LNURL error: ${data.reason}`);
  }
  
  return data;
}

async function createZapRequest(pool, relays, sk, recipientPubkey, amount, comment, eventId = null) {
  // Create NIP-57 zap request event
  const tags = [
    ['p', recipientPubkey],
    ['amount', (amount * 1000).toString()], // millisats
    ['relays', ...relays]
  ];
  
  if (eventId) {
    tags.push(['e', eventId]);
  }
  
  const zapRequest = {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    content: comment || '',
    tags
  };
  
  const signedEvent = finalizeEvent(zapRequest, sk);
  return signedEvent;
}

async function getInvoice(lnurlPayInfo, amount, zapRequest) {
  // Get invoice from callback URL
  const params = new URLSearchParams({
    amount: (amount * 1000).toString(), // millisats
    nostr: JSON.stringify(zapRequest)
  });
  
  const callbackUrl = `${lnurlPayInfo.callback}?${params}`;
  const res = await fetch(callbackUrl);
  
  if (!res.ok) {
    throw new Error(`Failed to get invoice: ${res.status}`);
  }
  
  const data = await res.json();
  
  if (data.status === 'ERROR') {
    throw new Error(`Invoice error: ${data.reason}`);
  }
  
  return data.pr; // BOLT11 invoice
}

async function payInvoice(nwcUrl, invoice) {
  // Parse NWC URL
  const url = new URL(nwcUrl);
  const relay = url.searchParams.get('relay');
  const secret = url.searchParams.get('secret');
  const pubkey = url.hostname;
  
  if (!relay || !secret) {
    throw new Error('Invalid NWC URL');
  }
  
  const sk = Buffer.from(secret, 'hex');
  const pool = new SimplePool();
  
  // Create pay_invoice request
  const request = {
    method: 'pay_invoice',
    params: {
      invoice
    }
  };
  
  const event = finalizeEvent({
    kind: 23194,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify(request),
    tags: [['p', pubkey]]
  }, sk);
  
  // Publish and wait for response
  return new Promise(async (resolve, reject) => {
    const sub = pool.subscribeMany([relay], [{
      kinds: [23195],
      '#e': [event.id],
      since: event.created_at - 10
    }], {
      onevent(responseEvent) {
        try {
          const response = JSON.parse(responseEvent.content);
          if (response.error) {
            reject(new Error(response.error.message || 'Payment failed'));
          } else {
            resolve(response.result);
          }
          sub.close();
          pool.close([relay]);
        } catch (e) {
          reject(e);
        }
      }
    });
    
    await pool.publish([relay], event);
    
    // Timeout after 30 seconds
    setTimeout(() => {
      sub.close();
      pool.close([relay]);
      reject(new Error('Payment timeout'));
    }, 30000);
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  
  if (args.length < 2) {
    console.error('❌ Usage: node tools/nostr-zap.mjs <target> <amount-sats> [comment]');
    process.exit(1);
  }
  
  const [targetArg, amountArg, ...commentParts] = args;
  const amount = parseInt(amountArg, 10);
  const comment = commentParts.join(' ');
  
  if (isNaN(amount) || amount <= 0) {
    console.error('❌ Amount must be a positive number');
    process.exit(1);
  }
  
  console.log('⚡ Kai\'s Zap Tool\n');
  
  // Load credentials
  const nostrCreds = loadCredentials('nostr.json');
  const nwcCreds = loadCredentials('nwc.json');
  const sk = Buffer.from(nostrCreds.privateKeyHex, 'hex');
  
  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
  const pool = new SimplePool();
  
  try {
    let recipientPubkey;
    let eventId = null;
    
    // Parse target (could be npub, hex, note, nevent)
    if (targetArg.startsWith('npub1')) {
      const decoded = nip19.decode(targetArg);
      recipientPubkey = decoded.data;
    } else if (targetArg.startsWith('nevent1')) {
      const decoded = nip19.decode(targetArg);
      eventId = decoded.data.id;
      recipientPubkey = decoded.data.author;
      
      // If no author in nevent, fetch the event
      if (!recipientPubkey) {
        const events = await pool.querySync(relays, { ids: [eventId], limit: 1 });
        if (events.length === 0) {
          throw new Error('Could not find this event');
        }
        recipientPubkey = events[0].pubkey;
      }
    } else if (targetArg.startsWith('note1')) {
      const decoded = nip19.decode(targetArg);
      eventId = decoded.data;
      const events = await pool.querySync(relays, { ids: [eventId], limit: 1 });
      if (events.length === 0) {
        throw new Error('Could not find this note');
      }
      recipientPubkey = events[0].pubkey;
    } else if (/^[0-9a-f]{64}$/i.test(targetArg)) {
      recipientPubkey = targetArg.toLowerCase();
    } else {
      throw new Error('Invalid target. Use npub, hex pubkey, note1, or nevent1');
    }
    
    console.log(`📍 Target: ${recipientPubkey.slice(0, 8)}...`);
    console.log(`💰 Amount: ${amount} sats`);
    if (comment) console.log(`💬 Comment: ${comment}`);
    if (eventId) console.log(`📝 Zapping note: ${eventId.slice(0, 8)}...`);
    
    // Get recipient's Lightning address
    console.log('\n🔍 Looking up Lightning address...');
    const { lud16, displayName } = await getProfileLud16(pool, relays, recipientPubkey);
    console.log(`👤 Recipient: ${displayName}`);
    console.log(`⚡ Address: ${lud16}`);
    
    // Get LNURL-pay info
    console.log('\n📡 Fetching payment info...');
    const lnurlPayInfo = await getLnurlPayInfo(lud16);
    
    // Check if zaps are supported
    if (!lnurlPayInfo.allowsNostr) {
      console.log('⚠️  This address does not support NIP-57 zaps, sending regular payment...');
    }
    
    // Check amount limits
    const minSats = Math.ceil(lnurlPayInfo.minSendable / 1000);
    const maxSats = Math.floor(lnurlPayInfo.maxSendable / 1000);
    
    if (amount < minSats || amount > maxSats) {
      throw new Error(`Amount must be between ${minSats} and ${maxSats} sats for this recipient`);
    }
    
    // Create zap request
    console.log('\n📝 Creating zap request...');
    const zapRequest = await createZapRequest(pool, relays, sk, recipientPubkey, amount, comment, eventId);
    
    // Get invoice
    console.log('🧾 Getting invoice...');
    const invoice = await getInvoice(lnurlPayInfo, amount, zapRequest);
    
    // Pay invoice
    console.log('💸 Paying invoice...');
    const result = await payInvoice(nwcCreds.nwc_url, invoice);
    
    console.log('\n✅ Zap sent successfully!');
    console.log(`   Amount: ${amount} sats`);
    console.log(`   To: ${displayName} (${lud16})`);
    if (result.preimage) {
      console.log(`   Preimage: ${result.preimage.slice(0, 16)}...`);
    }
    
    pool.close(relays);
    process.exit(0);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    pool.close(relays);
    process.exit(1);
  }
}

main();
