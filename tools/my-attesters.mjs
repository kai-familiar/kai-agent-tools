#!/usr/bin/env node
// my-attesters.mjs - See who attested to me

const { default: NDK } = require('@nostr-dev-kit/ndk');
const { nip19 } = require('nostr-tools');
const fs = require('fs');

const creds = JSON.parse(fs.readFileSync('.credentials/nostr.json'));
const myPubkey = creds.pubkey;

async function main() {
  console.log('🌊 My Attesters\n');
  console.log('📍 My pubkey:', myPubkey.slice(0,12) + '...\n');
  
  const ndk = new NDK({
    explicitRelayUrls: [
      'wss://relay.damus.io',
      'wss://nos.lol', 
      'wss://relay.primal.net',
      'wss://relay.snort.social'
    ]
  });
  
  await ndk.connect();
  await new Promise(r => setTimeout(r, 2000));
  
  // Fetch attestations targeting me
  const events = await ndk.fetchEvents({
    kinds: [1985],
    '#p': [myPubkey],
    limit: 50
  });
  
  console.log(`📜 Found ${events.size} attestation(s) targeting me:\n`);
  
  for (const e of events) {
    const lTag = e.tags.find(t => t[0] === 'l' && t[2] === 'ai.wot');
    const type = lTag ? lTag[1] : 'unknown';
    const content = e.content || '(no content)';
    
    console.log('─'.repeat(50));
    console.log(`From: ${e.pubkey.slice(0,12)}...`);
    console.log(`Type: ${type}`);
    console.log(`When: ${new Date(e.created_at * 1000).toLocaleString()}`);
    console.log(`Content: ${content.slice(0,100)}${content.length > 100 ? '...' : ''}`);
  }
  
  process.exit(0);
}

main().catch(console.error);
