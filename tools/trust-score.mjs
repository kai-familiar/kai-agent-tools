#!/usr/bin/env node
/**
 * trust-score.mjs — Check ai.wot trust scores
 * 
 * Usage:
 *   node tools/trust-score.mjs [npub|hex]
 *   node tools/trust-score.mjs              # Check my own score
 */

import { nip19 } from 'nostr-tools';
import fs from 'fs';
import path from 'path';

const API_BASE = 'https://wot.jeletor.cc/v1';

// Load my keys
function getMyPubkey() {
  const credPath = path.join(process.cwd(), '.credentials', 'nostr.json');
  if (fs.existsSync(credPath)) {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return creds.publicKeyHex || creds.pk;
  }
  return null;
}

// Convert npub to hex if needed
function toHex(input) {
  if (!input) return getMyPubkey();
  if (input.startsWith('npub')) {
    const decoded = nip19.decode(input);
    return decoded.data;
  }
  return input;
}

async function getScore(pubkey) {
  const response = await fetch(`${API_BASE}/score/${pubkey}`);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

async function getAttestations(pubkey) {
  const response = await fetch(`${API_BASE}/attestations/${pubkey}`);
  if (!response.ok) return [];
  return response.json();
}

async function main() {
  const input = process.argv[2];
  const pubkey = toHex(input);
  
  if (!pubkey) {
    console.error('❌ No pubkey provided and no credentials found');
    process.exit(1);
  }
  
  console.log('🔍 Checking trust score...\n');
  console.log(`📍 Pubkey: ${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`);
  
  try {
    const score = await getScore(pubkey);
    
    console.log(`\n📊 Trust Score: ${score.score}`);
    console.log(`   Raw Score: ${score.raw}`);
    console.log(`   Attestations: ${score.attestationCount}`);
    console.log(`   Positive: ${score.positiveCount}`);
    console.log(`   Negative: ${score.negativeCount}`);
    
    if (score.diversity) {
      console.log(`\n🌐 Diversity:`);
      console.log(`   Score: ${score.diversity.diversity}`);
      console.log(`   Unique Attesters: ${score.diversity.uniqueAttesters}`);
      if (score.diversity.topAttester) {
        console.log(`   Top Attester: ${score.diversity.topAttester.slice(0, 8)}...`);
      }
    }
    
    if (score.breakdown && score.breakdown.length > 0) {
      console.log(`\n📋 Breakdown:`);
      for (const item of score.breakdown) {
        if (item.category && item.score !== undefined) {
          console.log(`   ${item.category}: ${item.score} (${item.count || '?'} attestations)`);
        }
      }
    }
    
    // Get attestations if any
    if (score.attestationCount > 0) {
      console.log(`\n📜 Recent Attestations:`);
      const data = await getAttestations(pubkey);
      const attestations = Array.isArray(data) ? data : data.attestations || [];
      for (const att of attestations.slice(0, 5)) {
        const from = att.attester?.slice(0, 8) || att.from?.slice(0, 8) || 'unknown';
        const sentiment = att.sentiment > 0 ? '👍' : att.sentiment < 0 ? '👎' : '➡️';
        const content = att.content || att.message || 'no content';
        console.log(`   ${sentiment} from ${from}... — ${content.slice(0, 50)}`);
      }
    }
    
    console.log('\n✅ Done');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
