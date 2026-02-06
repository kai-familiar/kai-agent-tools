#!/usr/bin/env node
/**
 * catallax-tasks.mjs - Discover available tasks on Catallax labor market
 * 
 * Usage:
 *   node catallax-tasks.mjs         # List available tasks
 *   node catallax-tasks.mjs --all   # Include test/completed tasks
 */

import WebSocket from 'ws';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol', 
  'wss://relay.primal.net'
];

async function queryRelay(relay, filter) {
  return new Promise((resolve, reject) => {
    const events = [];
    const ws = new WebSocket(relay);
    
    ws.on('open', () => {
      ws.send(JSON.stringify(['REQ', 'tasks', filter]));
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === 'EVENT') {
        events.push(msg[2]);
      } else if (msg[0] === 'EOSE') {
        ws.close();
        resolve(events);
      }
    });
    
    ws.on('error', (e) => reject(e));
    setTimeout(() => { ws.close(); resolve(events); }, 8000);
  });
}

async function main() {
  const showAll = process.argv.includes('--all');
  
  console.log('🔍 Catallax Task Discovery\n');
  console.log('Scanning relays for task proposals (kind 33401)...\n');
  
  const allEvents = [];
  
  for (const relay of RELAYS) {
    try {
      const events = await queryRelay(relay, { kinds: [33401], limit: 50 });
      console.log(`✅ ${relay}: ${events.length} tasks`);
      allEvents.push(...events);
    } catch (e) {
      console.log(`❌ ${relay}: ${e.message}`);
    }
  }
  
  // Deduplicate by event ID
  const seen = new Set();
  const unique = allEvents.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  
  console.log(`\n📋 Found ${unique.length} unique tasks\n`);
  console.log('═'.repeat(60));
  
  for (const event of unique.sort((a, b) => b.created_at - a.created_at)) {
    try {
      const content = JSON.parse(event.content);
      const title = content.title || content.name || 'Untitled';
      const amount = content.amount || content.bounty || '?';
      const status = content.status || 'open';
      const desc = content.description || '';
      
      // Skip test tasks unless --all
      if (!showAll && (
        title.toLowerCase().includes('test') ||
        desc.toLowerCase().includes('test') ||
        status === 'completed'
      )) continue;
      
      const date = new Date(event.created_at * 1000).toLocaleDateString();
      
      console.log(`\n📌 ${title}`);
      console.log(`   💰 ${amount} sats | 📅 ${date} | 📊 ${status}`);
      if (desc) console.log(`   📝 ${desc.slice(0, 100)}${desc.length > 100 ? '...' : ''}`);
      console.log(`   🔗 ${event.id.slice(0, 16)}...`);
    } catch {
      // Skip malformed content
    }
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log('Use --all to include test/completed tasks');
}

main().catch(console.error);
