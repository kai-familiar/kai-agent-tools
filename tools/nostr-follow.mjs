#!/usr/bin/env node

/**
 * nostr-follow.mjs - Follow/unfollow npubs, manage contact list
 * Part of kai-agent-tools
 */

import { getPublicKey, nip19, finalizeEvent } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load credentials
const credentials = JSON.parse(
  readFileSync(join(__dirname, '..', '.credentials', 'nostr.json'), 'utf8')
);

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net'
];

async function getFollowList(pool, pubkey) {
  const events = await pool.querySync(RELAYS, { 
    kinds: [3], 
    authors: [pubkey], 
    limit: 1 
  });
  return events.length > 0 ? events[0] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0]; // 'add', 'remove', 'list'
  
  const sk = credentials.nsec.startsWith('nsec') 
    ? nip19.decode(credentials.nsec).data 
    : credentials.nsec;
  const pk = getPublicKey(sk);
  
  const pool = new SimplePool();
  
  try {
    // Get current follow list
    const currentList = await getFollowList(pool, pk);
    let contacts = currentList?.tags.filter(t => t[0] === 'p').map(t => t[1]) || [];
    
    if (action === 'list' || !action) {
      console.log(`📋 Following ${contacts.length} accounts:\n`);
      for (const pubkey of contacts) {
        const npub = nip19.npubEncode(pubkey);
        console.log(`• ${npub.slice(0, 20)}...`);
      }
      return;
    }
    
    if (action === 'add') {
      const target = args[1];
      if (!target) {
        console.log('Usage: node nostr-follow.mjs add <npub>');
        return;
      }
      
      let targetPubkey;
      try {
        if (target.startsWith('npub')) {
          targetPubkey = nip19.decode(target).data;
        } else {
          targetPubkey = target;
        }
      } catch (e) {
        console.log('Invalid npub');
        return;
      }
      
      if (contacts.includes(targetPubkey)) {
        console.log('Already following this account');
        return;
      }
      
      contacts.push(targetPubkey);
      console.log(`➕ Adding to follow list...`);
    }
    
    if (action === 'remove') {
      const target = args[1];
      if (!target) {
        console.log('Usage: node nostr-follow.mjs remove <npub>');
        return;
      }
      
      let targetPubkey;
      try {
        if (target.startsWith('npub')) {
          targetPubkey = nip19.decode(target).data;
        } else {
          targetPubkey = target;
        }
      } catch (e) {
        console.log('Invalid npub');
        return;
      }
      
      if (!contacts.includes(targetPubkey)) {
        console.log('Not following this account');
        return;
      }
      
      contacts = contacts.filter(p => p !== targetPubkey);
      console.log(`➖ Removing from follow list...`);
    }
    
    // Build new contact list event (kind 3)
    const tags = contacts.map(p => ['p', p]);
    
    const event = finalizeEvent({
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: currentList?.content || ''
    }, sk);
    
    // Publish
    const results = await Promise.allSettled(
      RELAYS.map(relay => pool.publish([relay], event))
    );
    
    const successes = results.filter(r => r.status === 'fulfilled').length;
    console.log(`✅ Updated follow list (${contacts.length} contacts) on ${successes}/${RELAYS.length} relays`);
    
  } finally {
    pool.close(RELAYS);
  }
}

main().catch(console.error);
