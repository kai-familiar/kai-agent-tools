#!/usr/bin/env node
/**
 * catallax-tasks.mjs - Browse the Catallax labor market on Nostr
 * 
 * Catallax uses custom kinds:
 *   33400: Arbiter announcements (who can mediate disputes)
 *   33401: Task proposals (jobs that need doing)
 *   3402:  Task conclusions (completed work)
 * 
 * Usage:
 *   node catallax-tasks.mjs                    # List open tasks
 *   node catallax-tasks.mjs --arbiters         # List available arbiters
 *   node catallax-tasks.mjs --completed        # Show completed tasks
 *   node catallax-tasks.mjs --limit 30         # More results
 */

import { SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';

const pool = new SimplePool();
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol', 
  'wss://relay.nostr.band',
  'wss://nostr.wine'
];

// Catallax event kinds
const KINDS = {
  ARBITER: 33400,
  TASK: 33401,
  CONCLUSION: 3402
};

async function getProfiles(pubkeys) {
  const profiles = {};
  if (pubkeys.length === 0) return profiles;
  
  const events = await pool.querySync(RELAYS, { 
    kinds: [0], 
    authors: [...new Set(pubkeys)]
  });
  
  for (const e of events) {
    if (!profiles[e.pubkey]) {
      try { profiles[e.pubkey] = JSON.parse(e.content); } catch {}
    }
  }
  return profiles;
}

function formatSats(amount) {
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K sats`;
  }
  return `${amount} sats`;
}

function getName(profiles, pubkey) {
  const p = profiles[pubkey];
  return p?.display_name || p?.name || `${pubkey.slice(0, 8)}...`;
}

async function listTasks(limit = 20) {
  console.log('\n📋 Browsing Catallax Task Proposals (kind 33401)...\n');
  
  const tasks = await pool.querySync(RELAYS, {
    kinds: [KINDS.TASK],
    limit
  });
  
  if (tasks.length === 0) {
    console.log('No task proposals found.');
    console.log('Try checking catallax.network directly or different relays.\n');
    return;
  }
  
  // Sort by time (newest first)
  tasks.sort((a, b) => b.created_at - a.created_at);
  
  // Get profiles
  const pubkeys = tasks.map(t => t.pubkey);
  const profiles = await getProfiles(pubkeys);
  
  console.log(`Found ${tasks.length} task proposal(s):\n`);
  
  for (const task of tasks) {
    const name = getName(profiles, task.pubkey);
    const time = new Date(task.created_at * 1000).toLocaleString();
    
    // Parse task details - Catallax stores JSON in content
    let title = 'Untitled';
    let description = '';
    let requirements = '';
    let price = null;
    let status = 'open';
    
    // Try to parse JSON content (Catallax format)
    try {
      const data = JSON.parse(task.content);
      title = data.title || 'Untitled';
      description = data.description || '';
      requirements = data.requirements || '';
    } catch {
      // Not JSON, use raw content
      description = task.content;
    }
    
    // Check tags for additional info
    price = task.tags.find(t => t[0] === 'price')?.[1] || 
            task.tags.find(t => t[0] === 'amount')?.[1];
    status = task.tags.find(t => t[0] === 'status')?.[1] || 'open';
    
    console.log('┌────────────────────────────────────────');
    console.log(`│ 📌 ${title}`);
    console.log(`│ 👤 Posted by: ${name}`);
    console.log(`│ 🕐 ${time}`);
    if (price) console.log(`│ 💰 ${formatSats(parseInt(price))}`);
    console.log(`│ 📊 Status: ${status}`);
    if (description) {
      const desc = description.slice(0, 250) + (description.length > 250 ? '...' : '');
      console.log(`│ 📝 ${desc.split('\n').join('\n│    ')}`);
    }
    if (requirements && requirements.length > 0 && requirements !== description) {
      const req = requirements.slice(0, 150) + (requirements.length > 150 ? '...' : '');
      console.log(`│ ✅ Requirements: ${req}`);
    }
    console.log(`│ 🔗 id: ${task.id.slice(0, 16)}...`);
    console.log('└────────────────────────────────────────\n');
  }
}

async function listArbiters(limit = 20) {
  console.log('\n⚖️ Browsing Catallax Arbiters (kind 33400)...\n');
  
  const arbiters = await pool.querySync(RELAYS, {
    kinds: [KINDS.ARBITER],
    limit
  });
  
  if (arbiters.length === 0) {
    console.log('No arbiter announcements found.');
    return;
  }
  
  arbiters.sort((a, b) => b.created_at - a.created_at);
  
  const pubkeys = arbiters.map(a => a.pubkey);
  const profiles = await getProfiles(pubkeys);
  
  console.log(`Found ${arbiters.length} arbiter(s):\n`);
  
  for (const arb of arbiters) {
    const name = getName(profiles, arb.pubkey);
    const time = new Date(arb.created_at * 1000).toLocaleString();
    const npub = nip19.npubEncode(arb.pubkey);
    
    // Parse arbiter details from content or tags
    let description = arb.content || 'No description';
    
    console.log('┌────────────────────────────────────────');
    console.log(`│ ⚖️ ${name}`);
    console.log(`│ 📍 ${npub.slice(0, 20)}...`);
    console.log(`│ 🕐 Announced: ${time}`);
    if (description.length > 0) {
      const desc = description.slice(0, 150) + (description.length > 150 ? '...' : '');
      console.log(`│ 📝 ${desc}`);
    }
    console.log('└────────────────────────────────────────\n');
  }
}

async function listCompleted(limit = 20) {
  console.log('\n✅ Browsing Completed Tasks (kind 3402)...\n');
  
  const conclusions = await pool.querySync(RELAYS, {
    kinds: [KINDS.CONCLUSION],
    limit
  });
  
  if (conclusions.length === 0) {
    console.log('No task conclusions found.');
    return;
  }
  
  conclusions.sort((a, b) => b.created_at - a.created_at);
  
  const pubkeys = conclusions.map(c => c.pubkey);
  const profiles = await getProfiles(pubkeys);
  
  console.log(`Found ${conclusions.length} completed task(s):\n`);
  
  for (const conc of conclusions) {
    const name = getName(profiles, conc.pubkey);
    const time = new Date(conc.created_at * 1000).toLocaleString();
    
    const outcome = conc.tags.find(t => t[0] === 'outcome')?.[1] || 'completed';
    const taskRef = conc.tags.find(t => t[0] === 'e')?.[1];
    
    console.log('┌────────────────────────────────────────');
    console.log(`│ ✅ Concluded by: ${name}`);
    console.log(`│ 🕐 ${time}`);
    console.log(`│ 📊 Outcome: ${outcome}`);
    if (taskRef) console.log(`│ 🔗 Task: ${taskRef.slice(0, 16)}...`);
    if (conc.content) {
      const desc = conc.content.slice(0, 150) + (conc.content.length > 150 ? '...' : '');
      console.log(`│ 📝 ${desc}`);
    }
    console.log('└────────────────────────────────────────\n');
  }
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 20;
  
  // Parse --limit flag
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1) {
    limit = parseInt(args[limitIdx + 1]) || 20;
    args.splice(limitIdx, 2);
  }
  
  try {
    if (args.includes('--arbiters')) {
      await listArbiters(limit);
    } else if (args.includes('--completed')) {
      await listCompleted(limit);
    } else if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Catallax Tasks Browser - Browse the Nostr labor market

Usage:
  node catallax-tasks.mjs                    List open task proposals
  node catallax-tasks.mjs --arbiters         List available arbiters
  node catallax-tasks.mjs --completed        Show completed tasks
  node catallax-tasks.mjs --limit 30         More results

Catallax (catallax.network) uses custom Nostr kinds:
  33400: Arbiter announcements
  33401: Task proposals  
  3402:  Task conclusions

More info: https://catallax.network
      `);
    } else {
      await listTasks(limit);
    }
  } finally {
    pool.close(RELAYS);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  pool.close(RELAYS);
});
