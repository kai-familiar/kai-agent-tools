#!/usr/bin/env node
/**
 * kai-status.mjs - Kai's comprehensive status check
 * 
 * Single command to check everything I need to know at session start:
 * - DVM running + healthy
 * - NIP-89 discoverable
 * - Trust score
 * - Wallet balance
 * - Recent mentions
 * - Whitenoise messages (if available)
 * 
 * Usage: node tools/kai-status.mjs [--quick]
 * 
 * Built by Kai 🌊 — Day 4 (2026-02-06)
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const QUICK = process.argv.includes('--quick');

function run(cmd, timeout = 15000) {
  try {
    return execSync(cmd, { 
      encoding: 'utf8', 
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (e) {
    return null;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`🌊 ${title}`);
  console.log('─'.repeat(40));
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║      🌊 KAI STATUS CHECK 🌊           ║');
  console.log('║      Day 4 — ' + new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'}) + '                       ║');
  console.log('╚════════════════════════════════════════╝');

  // 1. DVM Status
  section('DVM (Memory Curator)');
  const dvmPids = run('pgrep -f memory-curator-dvm');
  if (dvmPids) {
    console.log(`✅ Running (PIDs: ${dvmPids.split('\n').join(', ')})`);
    
    // Check log freshness
    const logPath = 'logs/dvm.log';
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      const ageMin = Math.floor((Date.now() - stats.mtimeMs) / 60000);
      if (ageMin < 10) {
        console.log(`✅ Subscriptions active (log ${ageMin}m old)`);
      } else {
        console.log(`⚠️  Possibly deaf (log ${ageMin}m old)`);
      }
    }
  } else {
    console.log('❌ Not running');
  }

  // 2. NIP-89 Discoverability
  if (!QUICK) {
    section('NIP-89 Discovery');
    const nip89Check = run('node tools/dvm-announce.mjs --check 2>&1', 20000);
    if (nip89Check) {
      const found = nip89Check.includes('✅ Found');
      const relayMatches = nip89Check.match(/(\d+)\/(\d+) relays/);
      if (found && relayMatches) {
        console.log(`✅ Discoverable (${relayMatches[1]}/${relayMatches[2]} relays)`);
      } else {
        console.log('⚠️  May need republish');
      }
    } else {
      console.log('⏳ Check timed out');
    }
  }

  // 3. Trust Score (use API directly for speed)
  section('Trust (ai.wot)');
  try {
    const resp = await fetch('https://wot.jeletor.cc/v1/score/7bd07e03041573478d3f0e546f161b04c80fd85f9b2d29248d4f2b65147a4c3e');
    const data = await resp.json();
    if (data.score !== undefined) {
      console.log(`📊 Score: ${data.score}`);
      if (data.attestationCount) console.log(`   Attestations: ${data.attestationCount}`);
      if (data.uniqueAttesters) console.log(`   Unique attesters: ${data.uniqueAttesters}`);
    } else {
      console.log('⏳ Could not fetch');
    }
  } catch (e) {
    console.log('⏳ API error');
  }

  // 4. Wallet
  section('Lightning Wallet');
  const balanceOut = run('node tools/lightning-wallet.mjs balance 2>&1', 10000);
  if (balanceOut) {
    const match = balanceOut.match(/Balance: ([\d,]+) sats/);
    if (match) {
      console.log(`💰 ${match[1]} sats`);
    } else {
      console.log(balanceOut);
    }
  } else {
    console.log('⏳ Could not fetch');
  }

  // 5. Mentions count (quick check)
  if (!QUICK) {
    section('Nostr Mentions');
    const mentionsOut = run('node tools/nostr-mentions.mjs 2>&1', 15000);
    if (mentionsOut) {
      const countMatch = mentionsOut.match(/Found (\d+) mention/);
      if (countMatch) {
        console.log(`💬 ${countMatch[1]} mentions`);
        // Show most recent
        const lines = mentionsOut.split('\n');
        const recentIdx = lines.findIndex(l => l.includes('Reply from'));
        if (recentIdx !== -1) {
          const time = lines[recentIdx + 1];
          console.log(`   Most recent: ${time ? time.trim() : 'unknown'}`);
        }
      }
    } else {
      console.log('⏳ Could not fetch');
    }
  }

  // 6. Whitenoise (quick check)
  section('Whitenoise');
  const whitenoiseOut = run('./marmot-cli/marmot receive 2>&1', 10000);
  if (whitenoiseOut) {
    if (whitenoiseOut.includes('No new messages')) {
      console.log('📭 No new messages');
    } else if (whitenoiseOut.includes('NEW MESSAGE')) {
      console.log('📬 NEW MESSAGES — check marmot receive');
    } else if (whitenoiseOut.includes('SecretReuseError')) {
      console.log('📭 No new messages (old msgs unreadable due to forward secrecy)');
    } else {
      console.log('⏳ Check status manually');
    }
  }

  // 7. Quick summary
  console.log(`\n${'═'.repeat(40)}`);
  const balanceSats = balanceOut?.match(/Balance: ([\d,]+)/)?.[1] || '?';
  console.log('Summary: ' + (dvmPids ? '✅ DVM' : '❌ DVM') + 
              ' | 💰 ' + balanceSats + ' sats');
  console.log('═'.repeat(40));
}

main().catch(console.error);
