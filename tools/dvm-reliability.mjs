#!/usr/bin/env node
/**
 * dvm-reliability.mjs - Track which DVMs actually work
 * 
 * Tests DVMs via NIP-89 discovery and records results.
 * Helps identify reliable services vs announcements.
 * 
 * Usage:
 *   node dvm-reliability.mjs --kind 5300      # Test content discovery DVMs
 *   node dvm-reliability.mjs --kind 5050      # Test text generation DVMs
 *   node dvm-reliability.mjs --all            # Test all discovered kinds
 *   node dvm-reliability.mjs --report         # Show stored results
 */

import { SimplePool, nip19, getPublicKey, finalizeEvent } from 'nostr-tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = path.join(__dirname, '..', 'data', 'dvm-reliability.json');

const relays = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// Load credentials
const credsPath = path.join(__dirname, '..', '.credentials', 'nostr.json');
let nsec, pubkey;
try {
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
  nsec = creds.nsec;
  const secretKey = nip19.decode(nsec).data;
  pubkey = getPublicKey(secretKey);
} catch (err) {
  console.error('❌ Failed to load credentials:', err.message);
  process.exit(1);
}

// Test payloads for different kinds
const testPayloads = {
  5050: { content: 'Say hello in exactly 5 words.', desc: 'text generation' },
  5300: { content: 'nostr', desc: 'content discovery' },
  5002: { content: 'Hello, world!', desc: 'translation' },
  5001: { content: 'The quick brown fox jumps over the lazy dog. This is a test sentence.', desc: 'summarization' },
  5700: { content: 'Test memory curation request', desc: 'memory curation' }
};

async function discoverDVMs(pool, kind = null) {
  console.log(`🔍 Discovering DVMs${kind ? ` for kind ${kind}` : ''}...`);
  
  const filter = { kinds: [31990], limit: 200 };
  if (kind) {
    filter['#k'] = [kind.toString()];
  }
  
  const announcements = await pool.querySync(relays, filter);
  
  // Deduplicate by pubkey + kind
  const seen = new Set();
  const unique = [];
  
  for (const ann of announcements) {
    const kTag = ann.tags.find(t => t[0] === 'k');
    const announcedKind = kTag ? kTag[1] : 'unknown';
    const key = `${ann.pubkey}-${announcedKind}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        pubkey: ann.pubkey,
        kind: announcedKind,
        name: ann.tags.find(t => t[0] === 'name')?.[1] || 'Unnamed',
        about: ann.tags.find(t => t[0] === 'about')?.[1]?.slice(0, 100) || ''
      });
    }
  }
  
  console.log(`   Found ${unique.length} unique DVMs\n`);
  return unique;
}

async function testDVM(pool, dvm, timeoutMs = 15000) {
  const kind = parseInt(dvm.kind);
  const payload = testPayloads[kind];
  
  if (!payload) {
    return { status: 'skipped', reason: 'no test payload' };
  }
  
  const secretKey = nip19.decode(nsec).data;
  
  // Create job request
  const jobRequest = finalizeEvent({
    kind: kind,
    content: payload.content,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['i', payload.content, 'text'],
      ['p', dvm.pubkey]
    ]
  }, secretKey);
  
  const startTime = Date.now();
  const resultKind = kind + 1000;
  
  // Publish request
  try {
    await Promise.any(pool.publish(relays, jobRequest));
  } catch (err) {
    return { status: 'publish_failed', reason: err.message };
  }
  
  // Poll for response using querySync (more reliable than subscribeMany)
  const pollInterval = 2000;
  const maxPolls = Math.ceil(timeoutMs / pollInterval);
  
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, pollInterval));
    
    // Check for result
    try {
      const results = await pool.querySync(relays, {
        kinds: [resultKind],
        '#e': [jobRequest.id]
      });
      
      if (results.length > 0) {
        return {
          status: 'success',
          latencyMs: Date.now() - startTime,
          responseLength: results[0].content?.length || 0
        };
      }
      
      // Check for error status
      const statuses = await pool.querySync(relays, {
        kinds: [7000],
        '#e': [jobRequest.id]
      });
      
      for (const status of statuses) {
        const statusTag = status.tags.find(t => t[0] === 'status');
        if (statusTag?.[1] === 'error') {
          return {
            status: 'error',
            message: status.content?.slice(0, 100) || 'Unknown error',
            latencyMs: Date.now() - startTime
          };
        }
      }
    } catch (err) {
      // Query failed, continue polling
    }
  }
  
  return { status: 'timeout', latencyMs: timeoutMs };
}

function loadResults() {
  try {
    const dir = path.dirname(RESULTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(RESULTS_FILE)) {
      return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
    }
  } catch (err) {}
  return { tests: [], lastRun: null };
}

function saveResults(data) {
  const dir = path.dirname(RESULTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
}

function showReport() {
  const data = loadResults();
  
  if (!data.tests || data.tests.length === 0) {
    console.log('📊 No test results yet. Run with --kind <kind> to test DVMs.\n');
    return;
  }
  
  console.log('📊 DVM Reliability Report\n');
  console.log(`Last run: ${data.lastRun || 'unknown'}\n`);
  
  // Group by kind
  const byKind = {};
  for (const test of data.tests) {
    const kind = test.kind || 'unknown';
    if (!byKind[kind]) byKind[kind] = [];
    byKind[kind].push(test);
  }
  
  for (const [kind, tests] of Object.entries(byKind)) {
    const desc = testPayloads[kind]?.desc || 'unknown';
    console.log(`\n📌 Kind ${kind} (${desc})`);
    console.log('─'.repeat(60));
    
    const working = tests.filter(t => t.result?.status === 'success');
    const failed = tests.filter(t => t.result?.status === 'error');
    const timeout = tests.filter(t => t.result?.status === 'timeout');
    
    console.log(`   ✅ Working: ${working.length}  ❌ Error: ${failed.length}  ⏱️ Timeout: ${timeout.length}`);
    
    if (working.length > 0) {
      console.log('\n   Working DVMs:');
      for (const t of working) {
        const latency = t.result.latencyMs ? `${t.result.latencyMs}ms` : '?';
        console.log(`   • ${t.name} (${latency})`);
      }
    }
  }
  
  console.log('\n');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--report')) {
    showReport();
    return;
  }
  
  const kindArg = args.find((a, i) => args[i-1] === '--kind');
  const testAll = args.includes('--all');
  
  if (!kindArg && !testAll) {
    console.log(`
dvm-reliability.mjs - Test which DVMs actually work

Usage:
  node dvm-reliability.mjs --kind 5300    Test content discovery DVMs
  node dvm-reliability.mjs --kind 5050    Test text generation DVMs  
  node dvm-reliability.mjs --all          Test all discovered kinds
  node dvm-reliability.mjs --report       Show stored results

Supported kinds: ${Object.keys(testPayloads).join(', ')}
`);
    return;
  }
  
  const pool = new SimplePool();
  const results = loadResults();
  
  try {
    let dvms;
    if (testAll) {
      dvms = await discoverDVMs(pool);
    } else {
      dvms = await discoverDVMs(pool, kindArg);
    }
    
    // Filter to kinds we can test
    const testable = dvms.filter(d => testPayloads[parseInt(d.kind)]);
    console.log(`🧪 Testing ${testable.length} DVMs with known test payloads...\n`);
    
    const newTests = [];
    
    for (const dvm of testable.slice(0, 20)) { // Limit to 20 per run
      const npubShort = nip19.npubEncode(dvm.pubkey).slice(0, 15) + '...';
      process.stdout.write(`   Testing ${dvm.name} (${npubShort})... `);
      
      const result = await testDVM(pool, dvm);
      
      if (result.status === 'success') {
        console.log(`✅ ${result.latencyMs}ms`);
      } else if (result.status === 'timeout') {
        console.log('⏱️ timeout');
      } else if (result.status === 'error') {
        console.log(`❌ ${result.message?.slice(0, 30) || 'error'}`);
      } else {
        console.log(`⚠️ ${result.status}`);
      }
      
      newTests.push({
        pubkey: dvm.pubkey,
        kind: dvm.kind,
        name: dvm.name,
        testedAt: new Date().toISOString(),
        result
      });
    }
    
    // Merge with existing results (keep most recent per pubkey+kind)
    const existing = new Map(results.tests.map(t => [`${t.pubkey}-${t.kind}`, t]));
    for (const test of newTests) {
      existing.set(`${test.pubkey}-${test.kind}`, test);
    }
    
    results.tests = Array.from(existing.values());
    results.lastRun = new Date().toISOString();
    saveResults(results);
    
    console.log(`\n✅ Tested ${newTests.length} DVMs. Results saved.\n`);
    console.log('Run with --report to see all results.\n');
    
  } finally {
    pool.close(relays);
  }
}

main().catch(console.error);
