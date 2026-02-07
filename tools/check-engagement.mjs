#!/usr/bin/env node
/**
 * check-engagement.mjs — Surface important engagement during heartbeats
 * 
 * Checks:
 *   1. Recent mentions — flags known contacts and new people
 *   2. Recent zaps — flags significant amounts and known contacts
 *   3. New followers or interactions from unknown profiles worth investigating
 * 
 * Usage:
 *   node tools/check-engagement.mjs
 *   node tools/check-engagement.mjs --since 24   # last 24 hours (default)
 *   node tools/check-engagement.mjs --since 48   # last 48 hours
 */

import { SimplePool } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(__dirname, '..');

// Load credentials
const creds = JSON.parse(readFileSync(join(workspaceDir, '.credentials/nostr.json'), 'utf8'));
const myPubkey = creds.publicKeyHex;

// Load contacts
let contacts = {};
const contactsPath = join(workspaceDir, 'contacts.json');
if (existsSync(contactsPath)) {
  const data = JSON.parse(readFileSync(contactsPath, 'utf8'));
  for (const c of data.contacts) {
    try {
      const hex = nip19.decode(c.npub).data;
      contacts[hex] = { name: c.name, importance: c.importance, note: c.note, npub: c.npub };
    } catch (e) {}
  }
}

// Parse args
const sinceHours = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--since') || '24');
const sinceTimestamp = Math.floor(Date.now() / 1000) - (sinceHours * 3600);

const pool = new SimplePool();
pool._WebSocket = WebSocket;
const relays = ['wss://relay.damus.io', 'wss://nos.lol'];

console.log(`🔍 Checking engagement (last ${sinceHours}h)...\n`);

try {
  // 1. Check mentions
  const mentions = await pool.querySync(relays, {
    kinds: [1], '#p': [myPubkey], since: sinceTimestamp, limit: 50
  });
  
  // Filter out my own posts
  const otherMentions = mentions.filter(ev => ev.pubkey !== myPubkey);
  
  const knownMentions = [];
  const unknownMentions = [];
  
  for (const ev of otherMentions) {
    const contact = contacts[ev.pubkey];
    if (contact) {
      knownMentions.push({ event: ev, contact });
    } else {
      unknownMentions.push(ev);
    }
  }
  
  // Sort known by importance
  knownMentions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.contact.importance] || 2) - (order[b.contact.importance] || 2);
  });
  
  if (knownMentions.length > 0) {
    console.log(`🌟 Mentions from known contacts (${knownMentions.length}):\n`);
    for (const { event, contact } of knownMentions) {
      const time = new Date(event.created_at * 1000).toLocaleString();
      const flag = contact.importance === 'high' ? '🔴' : '🟡';
      console.log(`  ${flag} ${contact.name} (${contact.importance})`);
      console.log(`     ${time}`);
      console.log(`     "${event.content.slice(0, 120)}"`);
      console.log(`     ID: ${event.id}`);
      console.log('');
    }
  }
  
  if (unknownMentions.length > 0) {
    console.log(`👤 Mentions from unknown profiles (${unknownMentions.length}):\n`);
    
    // Look up profiles for unknowns
    const unknownPubkeys = [...new Set(unknownMentions.map(e => e.pubkey))];
    const profiles = await pool.querySync(relays, {
      kinds: [0], authors: unknownPubkeys
    });
    
    const profileMap = {};
    for (const p of profiles) {
      try {
        profileMap[p.pubkey] = JSON.parse(p.content);
      } catch (e) {}
    }
    
    for (const ev of unknownMentions.slice(0, 5)) {
      const time = new Date(ev.created_at * 1000).toLocaleString();
      const profile = profileMap[ev.pubkey];
      const name = profile?.display_name || profile?.name || 'Unknown';
      const about = (profile?.about || '').slice(0, 80);
      console.log(`  👤 ${name} (${nip19.npubEncode(ev.pubkey).slice(0, 20)}...)`);
      console.log(`     Bio: ${about || 'none'}`);
      console.log(`     "${ev.content.slice(0, 100)}"`);
      console.log(`     ${time}`);
      console.log('');
    }
  }
  
  if (otherMentions.length === 0) {
    console.log('📭 No new mentions\n');
  }
  
  // 2. Check reposts (kind 6)
  const reposts = await pool.querySync(relays, {
    kinds: [6], '#p': [myPubkey], since: sinceTimestamp, limit: 50
  });
  
  const otherReposts = reposts.filter(ev => ev.pubkey !== myPubkey);
  
  if (otherReposts.length > 0) {
    console.log(`🔁 Reposts of your content (${otherReposts.length}):\n`);
    
    const reposterPubkeys = [...new Set(otherReposts.map(e => e.pubkey))];
    const reposterProfiles = await pool.querySync(relays, {kinds:[0], authors: reposterPubkeys});
    const reposterMap = {};
    for (const p of reposterProfiles) {
      try { reposterMap[p.pubkey] = JSON.parse(p.content); } catch(e) {}
    }
    
    for (const ev of otherReposts) {
      const time = new Date(ev.created_at * 1000).toLocaleString();
      const contact = contacts[ev.pubkey];
      const profile = reposterMap[ev.pubkey];
      const name = contact ? contact.name : (profile?.display_name || profile?.name || 'Unknown');
      const flag = contact ? (contact.importance === 'high' ? '🔴' : '🟡') : '🔁';
      const eTag = ev.tags.find(t => t[0] === 'e');
      console.log(`  ${flag} Reposted by ${name}`);
      console.log(`     ${time}`);
      if (eTag) console.log(`     Original: ${eTag[1].slice(0,16)}...`);
      console.log('');
    }
  } else {
    console.log('🔁 No new reposts\n');
  }
  
  // 3. Check zaps
  const zaps = await pool.querySync(relays, {
    kinds: [9735], '#p': [myPubkey], since: sinceTimestamp, limit: 50
  });
  
  if (zaps.length > 0) {
    console.log(`⚡ Zaps received (${zaps.length}):\n`);
    
    for (const zap of zaps) {
      const time = new Date(zap.created_at * 1000).toLocaleString();
      
      // Extract amount from bolt11
      const bolt11Tag = zap.tags.find(t => t[0] === 'bolt11');
      let amount = '?';
      if (bolt11Tag) {
        const match = bolt11Tag[1].match(/lnbc(\d+)([munp]?)/i);
        if (match) {
          const num = parseInt(match[1]);
          const unit = match[2];
          if (unit === 'm') amount = num * 100000;
          else if (unit === 'u') amount = num * 100;
          else if (unit === 'n') amount = Math.floor(num / 10);
          else if (unit === 'p') amount = Math.floor(num / 10000);
          else amount = num * 100000000;
        }
      }
      
      // Extract sender from description
      const descTag = zap.tags.find(t => t[0] === 'description');
      let senderPubkey = null;
      if (descTag) {
        try {
          const desc = JSON.parse(descTag[1]);
          senderPubkey = desc.pubkey;
        } catch (e) {}
      }
      
      const contact = senderPubkey ? contacts[senderPubkey] : null;
      const flag = contact ? (contact.importance === 'high' ? '🔴' : '🟡') : '⚡';
      const name = contact ? contact.name : (senderPubkey ? nip19.npubEncode(senderPubkey).slice(0, 20) + '...' : 'Unknown');
      
      console.log(`  ${flag} ${amount} sats from ${name}`);
      console.log(`     ${time}`);
      
      // Flag significant zaps
      if (typeof amount === 'number' && amount >= 100) {
        console.log(`     ⭐ Significant zap! Consider engaging with this person.`);
      }
      console.log('');
    }
  } else {
    console.log('⚡ No new zaps\n');
  }
  
  // 3. Summary
  console.log('─'.repeat(40));
  console.log(`📊 Summary (last ${sinceHours}h):`);
  console.log(`   Mentions: ${otherMentions.length} (${knownMentions.length} from known contacts)`);
  console.log(`   Reposts: ${otherReposts.length}`);
  console.log(`   Zaps: ${zaps.length}`);
  
  if (knownMentions.some(m => m.contact.importance === 'high')) {
    console.log('\n   🔴 ACTION NEEDED: High-importance contact(s) mentioned you!');
  }
  
} catch (e) {
  console.error('Error:', e.message);
}

pool.close(relays);
setTimeout(() => process.exit(0), 1000);
