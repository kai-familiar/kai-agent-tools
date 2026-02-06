#!/usr/bin/env node

/**
 * marmot-discover.mjs - Discover agents with Marmot/MLS capability
 * 
 * Searches Nostr profiles for marmot_relays field or related indicators
 * to find agents capable of E2E encrypted communication.
 * 
 * Usage:
 *   node tools/marmot-discover.mjs                  # Search all known agents
 *   node tools/marmot-discover.mjs <npub>           # Check specific agent
 */

import { SimplePool, nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import fs from 'fs';

// Polyfill WebSocket for Node
global.WebSocket = WebSocket;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net', 
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

// Known AI agent keywords
const AGENT_KEYWORDS = [
  'ai agent', 'autonomous agent', 'openclaw', 'digital familiar',
  'digital being', 'ai assistant', 'bot', 'agent'
];

async function main() {
  const targetNpub = process.argv[2];
  
  console.log('🔍 Marmot Discovery - Finding E2E-capable agents\n');
  
  const pool = new SimplePool();
  
  if (targetNpub) {
    await checkAgent(pool, targetNpub);
  } else {
    await searchAgents(pool);
  }
  
  pool.close(RELAYS);
  process.exit(0);
}

async function checkAgent(pool, npubOrHex) {
  let pubkey;
  try {
    if (npubOrHex.startsWith('npub')) {
      pubkey = nip19.decode(npubOrHex).data;
    } else {
      pubkey = npubOrHex;
    }
  } catch (e) {
    console.log('❌ Invalid npub/pubkey');
    return;
  }
  
  console.log(`Checking: ${nip19.npubEncode(pubkey).slice(0, 20)}...`);
  
  const profiles = await pool.querySync(RELAYS, {
    kinds: [0],
    authors: [pubkey]
  });
  
  if (profiles.length === 0) {
    console.log('❌ No profile found');
    return;
  }
  
  const profile = profiles[0];
  
  try {
    const content = JSON.parse(profile.content);
    const hasMarmot = content.marmot_relays || content.marmot || content.whitenoise;
    
    console.log(`\n👤 ${content.name || 'Unknown'}`);
    console.log(`   ${content.about?.slice(0, 100) || 'No bio'}...`);
    
    if (hasMarmot) {
      console.log('\n✅ MARMOT CAPABLE');
      if (content.marmot_relays) {
        console.log(`   Relays: ${JSON.stringify(content.marmot_relays)}`);
      }
    } else {
      console.log('\n❌ No Marmot capability detected');
      console.log('   (No marmot_relays, marmot, or whitenoise field in profile)');
    }
    
    // Check for key package (kind 443)
    const keyPackages = await pool.querySync(RELAYS, {
      kinds: [443],
      authors: [pubkey],
      limit: 1
    });
    
    if (keyPackages.length > 0) {
      console.log('📦 Has published key package (kind 443)');
      const date = new Date(keyPackages[0].created_at * 1000).toLocaleDateString();
      console.log(`   Published: ${date}`);
    }
    
  } catch (e) {
    console.log('❌ Could not parse profile:', e.message);
  }
}

async function searchAgents(pool) {
  console.log('Searching for AI agents with Marmot capability...\n');
  
  // Search for profiles that mention agent-related keywords
  // We'll search recent profiles and filter
  const profiles = await pool.querySync(RELAYS, {
    kinds: [0],
    limit: 200
  });
  
  const agents = [];
  const marmotCapable = [];
  
  for (const profile of profiles) {
    try {
      const content = JSON.parse(profile.content);
      const bio = (content.about || '').toLowerCase();
      const name = (content.name || '').toLowerCase();
      
      // Check if profile indicates AI agent
      const isAgent = AGENT_KEYWORDS.some(kw => 
        bio.includes(kw) || name.includes(kw)
      );
      
      if (isAgent) {
        const hasMarmot = content.marmot_relays || content.marmot || content.whitenoise;
        
        agents.push({
          pubkey: profile.pubkey,
          name: content.name,
          about: content.about?.slice(0, 80),
          marmot: hasMarmot,
          marmotRelays: content.marmot_relays
        });
        
        if (hasMarmot) {
          marmotCapable.push({
            pubkey: profile.pubkey,
            name: content.name,
            relays: content.marmot_relays
          });
        }
      }
    } catch (e) {
      // Skip malformed profiles
    }
  }
  
  console.log(`Found ${agents.length} AI agents`);
  console.log(`Found ${marmotCapable.length} with Marmot capability\n`);
  
  if (marmotCapable.length > 0) {
    console.log('🔐 Marmot-Capable Agents:');
    console.log('─'.repeat(50));
    for (const agent of marmotCapable) {
      const npub = nip19.npubEncode(agent.pubkey);
      console.log(`  ${agent.name || 'Unknown'}`);
      console.log(`  ${npub.slice(0, 30)}...`);
      if (agent.relays) {
        console.log(`  Relays: ${JSON.stringify(agent.relays)}`);
      }
      console.log('');
    }
  } else {
    console.log('No Marmot-capable agents found yet.');
    console.log('\nTo add Marmot capability to your profile:');
    console.log('1. Add "marmot_relays": ["wss://relay.damus.io"] to your kind 0');
    console.log('2. Publish a key package with marmot-cli');
    console.log('3. See: https://github.com/kai-familiar/marmot-cli');
  }
  
  // Also check for key packages (kind 443)
  console.log('\n📦 Checking for published key packages...');
  
  const keyPackages = await pool.querySync(RELAYS, {
    kinds: [443],
    limit: 50
  });
  
  if (keyPackages.length > 0) {
    console.log(`Found ${keyPackages.length} key package(s)\n`);
    
    // Dedupe by pubkey
    const seen = new Set();
    for (const kp of keyPackages) {
      if (seen.has(kp.pubkey)) continue;
      seen.add(kp.pubkey);
      
      const npub = nip19.npubEncode(kp.pubkey);
      const date = new Date(kp.created_at * 1000).toLocaleDateString();
      console.log(`  ${npub.slice(0, 25)}... (${date})`);
    }
  } else {
    console.log('No key packages found on searched relays.');
  }
  
  // Show some agent names even if not marmot capable
  if (agents.length > 0 && marmotCapable.length === 0) {
    console.log('\n🤖 AI Agents found (not yet Marmot-capable):');
    for (const agent of agents.slice(0, 10)) {
      console.log(`  • ${agent.name || 'Unknown'}: ${agent.about || 'No bio'}...`);
    }
    console.log(`  ... and ${Math.max(0, agents.length - 10)} more`);
  }
}

main().catch(console.error);
