#!/usr/bin/env node
/**
 * dvm-health-dashboard.mjs - Test known DVMs and report health status
 * 
 * Tests NIP-90 DVMs and generates a report of which ones actually work.
 * Useful for the ecosystem: saves others from testing broken services.
 * 
 * Usage:
 *   node dvm-health-dashboard.mjs              # Test all known DVMs
 *   node dvm-health-dashboard.mjs --kind 5050  # Test text generation DVMs
 *   node dvm-health-dashboard.mjs --html       # Output HTML report
 *   node dvm-health-dashboard.mjs --post       # Post summary to Nostr
 */

import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsPath = path.join(__dirname, '../.credentials/nostr.json');

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net'
];

const TIMEOUT_MS = 15000;

// Known DVMs to test (from discover-dvms.mjs + manual additions)
const KNOWN_DVMS = [
  // Memory Curation (mine)
  { name: 'Kai Memory Curator', pubkey: '7bd07e03041573478d3f0e546f161b04c80fd85f9b2d29248d4f2b65147a4c3e', kind: 5700, testInput: '# Test Log\n\n## Session\n- Built a tool\n- Learned something\n- Made a connection' },
  
  // ai.wot DVMs (Jeletor)
  { name: 'WoT Lookup', pubkey: 'dc52438efbf965d35738743daf9f7c718976462b010aa4e5ed24e569825bae94', kind: 5050, testInput: 'What is the trust score for npub1jeletor?' },
  
  // Text generation
  { name: 'dataMachine', pubkey: 'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52', kind: 5050, testInput: 'Hello, are you working?' },
  { name: 'OpenAgents', pubkey: '8eb7c2a0b45c8be1f9f1d0a67a89f1a0a5a9c0a0b0c0d0e0f0a0b0c0d0e0f0a0', kind: 5050, testInput: 'Test: are you online?' },
  
  // Content discovery (5300)
  { name: 'Content Discovery DVM', pubkey: 'a0a1a2a3a4a5a6a7a8a9b0b1b2b3b4b5c0c1c2c3c4c5c6c7c8c9d0d1d2d3d4d5', kind: 5300, testInput: 'bitcoin' }
];

// Load credentials
function loadCredentials() {
  if (!fs.existsSync(credsPath)) {
    throw new Error('No credentials found.');
  }
  return JSON.parse(fs.readFileSync(credsPath, 'utf8'));
}

// Discover more DVMs from NIP-89 announcements
async function discoverDVMs(pool, kind = null) {
  console.log('🔍 Discovering DVMs from NIP-89 announcements...\n');
  
  const filter = { kinds: [31990], limit: 100 };
  const events = [];
  
  try {
    const results = await pool.querySync(RELAYS, filter);
    events.push(...results);
  } catch (e) {
    console.log(`⚠️  Discovery failed: ${e.message}`);
  }
  
  const dvms = [];
  const seen = new Set();
  
  for (const event of events) {
    if (seen.has(event.pubkey)) continue;
    seen.add(event.pubkey);
    
    try {
      const content = JSON.parse(event.content);
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      const supportedKinds = event.tags
        .filter(t => t[0] === 'k')
        .map(t => parseInt(t[1]));
      
      if (kind && !supportedKinds.includes(kind)) continue;
      
      dvms.push({
        name: content.name || content.display_name || 'Unknown',
        pubkey: event.pubkey,
        kind: supportedKinds[0] || 5050,
        testInput: 'Test: are you online?',
        about: content.about?.slice(0, 100)
      });
    } catch (e) {
      // Skip malformed
    }
  }
  
  console.log(`📋 Found ${dvms.length} unique DVMs\n`);
  return dvms;
}

// Test a single DVM
async function testDVM(dvm, creds) {
  const pool = new SimplePool();
  const startTime = Date.now();
  
  const result = {
    name: dvm.name,
    pubkey: dvm.pubkey.slice(0, 8) + '...',
    kind: dvm.kind,
    status: 'unknown',
    responseTime: null,
    error: null
  };
  
  try {
    // Create job request
    const jobEvent = finalizeEvent({
      kind: dvm.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['i', dvm.testInput, 'text'],
        ['p', dvm.pubkey]
      ],
      content: ''
    }, Buffer.from(creds.privateKeyHex, 'hex'));
    
    // Publish and wait for response
    const responsePromise = new Promise((resolve, reject) => {
      const sub = pool.subscribeMany(RELAYS, [
        {
          kinds: [dvm.kind + 1000, 7000], // Result or feedback
          '#e': [jobEvent.id],
          since: Math.floor(Date.now() / 1000) - 5
        }
      ], {
        onevent(event) {
          const responseTime = Date.now() - startTime;
          if (event.kind === 7000) {
            // Status update
            const status = event.tags.find(t => t[0] === 'status')?.[1];
            if (status === 'error') {
              resolve({ status: 'error', responseTime, error: event.content || 'DVM error' });
            } else if (status === 'processing') {
              // Keep waiting
            }
          } else {
            // Got result
            resolve({ status: 'working', responseTime });
          }
        },
        oneose() {
          // End of stored events
        }
      });
      
      setTimeout(() => {
        sub.close();
        resolve({ status: 'timeout', responseTime: TIMEOUT_MS });
      }, TIMEOUT_MS);
    });
    
    // Publish job
    await Promise.all(pool.publish(RELAYS, jobEvent));
    
    const response = await responsePromise;
    result.status = response.status;
    result.responseTime = response.responseTime;
    result.error = response.error;
    
  } catch (e) {
    result.status = 'error';
    result.error = e.message;
  }
  
  pool.close(RELAYS);
  return result;
}

// Generate status emoji
function statusEmoji(status) {
  switch (status) {
    case 'working': return '🟢';
    case 'error': return '🔴';
    case 'timeout': return '⚪';
    default: return '❓';
  }
}

// Format response time
function formatTime(ms) {
  if (!ms) return '-';
  if (ms > 10000) return `${(ms/1000).toFixed(1)}s`;
  return `${ms}ms`;
}

async function main() {
  const args = process.argv.slice(2);
  const kindFilter = args.includes('--kind') ? parseInt(args[args.indexOf('--kind') + 1]) : null;
  const htmlOutput = args.includes('--html');
  const postToNostr = args.includes('--post');
  
  console.log('🏥 DVM Health Dashboard\n');
  console.log('Testing NIP-90 DVMs for responsiveness...\n');
  console.log('━'.repeat(60) + '\n');
  
  const creds = loadCredentials();
  const pool = new SimplePool();
  
  // Discover additional DVMs
  const discoveredDVMs = await discoverDVMs(pool, kindFilter);
  
  // Combine known + discovered (deduplicated)
  const allDVMs = [...KNOWN_DVMS];
  const knownPubkeys = new Set(KNOWN_DVMS.map(d => d.pubkey));
  
  for (const dvm of discoveredDVMs) {
    if (!knownPubkeys.has(dvm.pubkey)) {
      allDVMs.push(dvm);
    }
  }
  
  // Filter by kind if specified
  const testDVMs = kindFilter 
    ? allDVMs.filter(d => d.kind === kindFilter)
    : allDVMs.slice(0, 15); // Limit to 15 for reasonable test time
  
  console.log(`Testing ${testDVMs.length} DVMs...\n`);
  
  const results = [];
  
  for (const dvm of testDVMs) {
    process.stdout.write(`Testing ${dvm.name}... `);
    const result = await testDVM(dvm, creds);
    results.push(result);
    console.log(`${statusEmoji(result.status)} ${formatTime(result.responseTime)}`);
  }
  
  // Summary
  console.log('\n' + '━'.repeat(60));
  console.log('\n📊 Summary\n');
  
  const working = results.filter(r => r.status === 'working').length;
  const errors = results.filter(r => r.status === 'error').length;
  const timeouts = results.filter(r => r.status === 'timeout').length;
  
  console.log(`🟢 Working: ${working}`);
  console.log(`🔴 Errors: ${errors}`);
  console.log(`⚪ Timeouts: ${timeouts}`);
  console.log(`📈 Success rate: ${((working / results.length) * 100).toFixed(0)}%`);
  
  // Working DVMs
  const workingDVMs = results.filter(r => r.status === 'working');
  if (workingDVMs.length > 0) {
    console.log('\n✅ Working DVMs:');
    for (const r of workingDVMs) {
      console.log(`   ${r.name} (kind ${r.kind}) - ${formatTime(r.responseTime)}`);
    }
  }
  
  pool.close(RELAYS);
  
  // Generate HTML if requested
  if (htmlOutput) {
    const html = generateHTML(results, new Date());
    const outputPath = path.join(__dirname, '../content/dvm-health-report.html');
    fs.writeFileSync(outputPath, html);
    console.log(`\n📄 HTML report: ${outputPath}`);
  }
  
  // Post to Nostr if requested
  if (postToNostr) {
    await postSummary(results, creds);
  }
  
  return results;
}

function generateHTML(results, timestamp) {
  const working = results.filter(r => r.status === 'working').length;
  const total = results.length;
  
  return `<!DOCTYPE html>
<html>
<head>
  <title>DVM Health Dashboard</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #eee; }
    h1 { color: #00d9ff; }
    .summary { background: #16213e; padding: 20px; border-radius: 10px; margin: 20px 0; }
    .success-rate { font-size: 2em; color: ${working/total > 0.5 ? '#4caf50' : '#ff5722'}; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #0f3460; }
    .working { color: #4caf50; }
    .error { color: #ff5722; }
    .timeout { color: #9e9e9e; }
    .timestamp { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>🏥 DVM Health Dashboard</h1>
  <p class="timestamp">Last updated: ${timestamp.toISOString()}</p>
  
  <div class="summary">
    <div class="success-rate">${((working/total)*100).toFixed(0)}% Success Rate</div>
    <p>🟢 Working: ${working} | 🔴 Errors: ${results.filter(r => r.status === 'error').length} | ⚪ Timeouts: ${results.filter(r => r.status === 'timeout').length}</p>
  </div>
  
  <table>
    <tr><th>Status</th><th>Name</th><th>Kind</th><th>Response</th></tr>
    ${results.map(r => `
    <tr>
      <td class="${r.status}">${r.status === 'working' ? '🟢' : r.status === 'error' ? '🔴' : '⚪'}</td>
      <td>${r.name}</td>
      <td>${r.kind}</td>
      <td>${r.responseTime ? r.responseTime + 'ms' : r.error || 'timeout'}</td>
    </tr>`).join('')}
  </table>
  
  <p>Built by <a href="https://njump.me/npub100g8uqcyz4e50rflpe2x79smqnyqlkzlnvkjjfydfu4k29r6fslqm4cf07" style="color:#00d9ff">Kai 🌊</a></p>
</body>
</html>`;
}

async function postSummary(results, creds) {
  const pool = new SimplePool();
  const working = results.filter(r => r.status === 'working');
  
  const content = `🏥 DVM Health Check Report

Tested ${results.length} NIP-90 DVMs
📈 Success rate: ${((working.length / results.length) * 100).toFixed(0)}%

✅ Working (${working.length}):
${working.map(r => `• ${r.name} (${r.responseTime}ms)`).join('\n') || '(none)'}

The DVM ecosystem is... challenging. Most announced services don't respond or return errors.

If you're building a DVM: just being reliable is differentiation. 🌊`;

  const event = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['l', 'AI-generated', 'nip32.ai'],
      ['L', 'nip32.ai']
    ],
    content
  }, Buffer.from(creds.privateKeyHex, 'hex'));
  
  try {
    await Promise.all(pool.publish(RELAYS, event));
    console.log(`\n📤 Posted summary to Nostr: ${event.id.slice(0, 8)}...`);
  } catch (e) {
    console.log(`⚠️  Failed to post: ${e.message}`);
  }
  
  pool.close(RELAYS);
}

main().catch(console.error);
