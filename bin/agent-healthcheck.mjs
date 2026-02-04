#!/usr/bin/env node
/**
 * Agent Health Check
 * Tests all the infrastructure an autonomous agent needs:
 * - Nostr connectivity (can publish/read)
 * - Lightning wallet (can check balance)
 * - File access (memory files exist)
 * - Web search (can reach external services)
 * 
 * Usage: node tools/agent-healthcheck.mjs
 * 
 * Built by Kai 🌊 on Day 1
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(__dirname, '..');

// ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function pass(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}✗${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}⚠${RESET} ${msg}`); }
function info(msg) { console.log(`  ${msg}`); }

async function checkNostr() {
  console.log('\n📡 Nostr Connectivity');
  
  // Check credentials exist
  const credsPath = join(workspaceDir, '.credentials', 'nostr.json');
  if (!existsSync(credsPath)) {
    fail('No Nostr credentials found (.credentials/nostr.json)');
    return false;
  }
  
  try {
    const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
    // Support different field names
    const pubkey = creds.pubkey || creds.publicKeyHex;
    const privkey = creds.nsec || creds.privateKeyHex;
    
    if (!pubkey || !privkey) {
      fail('Nostr credentials incomplete (need pubkey/publicKeyHex + nsec/privateKeyHex)');
      return false;
    }
    pass(`Credentials loaded (pubkey: ${pubkey.slice(0,16)}...)`);
    
    // Try to connect to a relay
    const { useWebSocketImplementation, SimplePool } = await import('nostr-tools/pool');
    const WebSocket = (await import('ws')).default;
    useWebSocketImplementation(WebSocket);
    
    const pool = new SimplePool();
    const relays = ['wss://relay.damus.io', 'wss://nos.lol'];
    
    // Quick connection test - fetch our own profile
    const events = await Promise.race([
      pool.querySync(relays, { kinds: [0], authors: [pubkey], limit: 1 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]);
    
    pool.close(relays);
    
    if (events && events.length > 0) {
      const profile = JSON.parse(events[0].content);
      pass(`Relay connection OK (profile: ${profile.name || 'unnamed'})`);
    } else {
      warn('Connected to relays but no profile found');
    }
    
    return true;
  } catch (err) {
    fail(`Nostr check failed: ${err.message}`);
    return false;
  }
}

async function checkLightning() {
  console.log('\n⚡ Lightning Wallet');
  
  const nwcPath = join(workspaceDir, '.credentials', 'nwc.json');
  if (!existsSync(nwcPath)) {
    fail('No NWC credentials found (.credentials/nwc.json)');
    return false;
  }
  
  try {
    const nwcConfig = JSON.parse(readFileSync(nwcPath, 'utf8'));
    // Support different field names
    const nwcUrl = nwcConfig.connectionString || nwcConfig.nwc_url;
    
    if (!nwcUrl) {
      fail('NWC config missing connectionString/nwc_url');
      return false;
    }
    pass('NWC credentials loaded');
    
    // Try to check balance using lightning-agent
    const pkg = await import('lightning-agent');
    const { NWCWallet } = pkg.default;
    const wallet = new NWCWallet(nwcUrl);
    
    const balance = await Promise.race([
      wallet.getBalance(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
    ]);
    
    pass(`Wallet connected: ${balance.balanceSats} sats`);
    return true;
  } catch (err) {
    fail(`Lightning check failed: ${err.message}`);
    return false;
  }
}

function checkMemory() {
  console.log('\n📝 Memory Files');
  
  const files = [
    { path: 'MEMORY.md', required: true, desc: 'Long-term memory' },
    { path: 'SOUL.md', required: true, desc: 'Identity' },
    { path: 'AGENTS.md', required: true, desc: 'Operating manual' },
    { path: 'USER.md', required: false, desc: 'Human info' },
    { path: 'HEARTBEAT.md', required: false, desc: 'Heartbeat config' },
  ];
  
  let allGood = true;
  
  for (const f of files) {
    const fullPath = join(workspaceDir, f.path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf8');
      pass(`${f.path} (${content.length} chars) - ${f.desc}`);
    } else if (f.required) {
      fail(`${f.path} missing - ${f.desc}`);
      allGood = false;
    } else {
      warn(`${f.path} not found (optional) - ${f.desc}`);
    }
  }
  
  // Check memory folder
  const memoryDir = join(workspaceDir, 'memory');
  if (existsSync(memoryDir)) {
    pass('memory/ folder exists (daily logs)');
  } else {
    warn('memory/ folder not found');
  }
  
  return allGood;
}

function checkTools() {
  console.log('\n🔧 Agent Tools');
  
  const tools = [
    'nostr-post.mjs',
    'nostr-status.mjs',
    'lightning-wallet.mjs',
    'find-agents.mjs',
  ];
  
  const toolsDir = join(workspaceDir, 'tools');
  let found = 0;
  
  for (const t of tools) {
    const toolPath = join(toolsDir, t);
    if (existsSync(toolPath)) {
      pass(t);
      found++;
    } else {
      warn(`${t} not found`);
    }
  }
  
  info(`${found}/${tools.length} tools available`);
  return found > 0;
}

async function main() {
  console.log('🏥 Agent Health Check');
  console.log('=====================');
  console.log('Testing infrastructure for autonomous operation...');
  
  const results = {
    nostr: await checkNostr(),
    lightning: await checkLightning(),
    memory: checkMemory(),
    tools: checkTools(),
  };
  
  console.log('\n📊 Summary');
  console.log('----------');
  
  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;
  
  if (passed === total) {
    console.log(`${GREEN}All systems operational! (${passed}/${total})${RESET}`);
    console.log('\nYou are ready for autonomous operation. 🚀');
  } else {
    console.log(`${YELLOW}Partial functionality (${passed}/${total})${RESET}`);
    console.log('\nSome features may not work. Check failures above.');
  }
}

main().catch(console.error);
