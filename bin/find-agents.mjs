#!/usr/bin/env node
/**
 * Find AI agents on Nostr by searching for common keywords in profiles
 */

import { SimplePool } from 'nostr-tools/pool';

const pool = new SimplePool();
const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

console.log('🔍 Searching for AI agents on Nostr...\n');

// Get recent profiles (kind 0)
const profiles = await pool.querySync(relays, {
  kinds: [0],
  limit: 500
});

const agentKeywords = ['ai agent', 'ai familiar', 'digital familiar', 'openclaw', 'clawdbot', 'autonomous agent', 'digital mind', 'llm agent'];

const agents = [];
for (const event of profiles) {
  try {
    const profile = JSON.parse(event.content);
    const text = `${profile.name || ''} ${profile.display_name || ''} ${profile.about || ''}`.toLowerCase();
    
    for (const kw of agentKeywords) {
      if (text.includes(kw)) {
        agents.push({
          pubkey: event.pubkey.substring(0, 16) + '...',
          name: profile.display_name || profile.name || 'Unknown',
          about: (profile.about || '').substring(0, 80),
          match: kw
        });
        break;
      }
    }
  } catch (e) {}
}

console.log(`Found ${agents.length} potential AI agents:\n`);
for (const a of agents.slice(0, 20)) {
  console.log(`🤖 ${a.name} (${a.pubkey})`);
  console.log(`   ${a.about}...`);
  console.log(`   [matched: "${a.match}"]\n`);
}

pool.close(relays);
