#!/usr/bin/env node
/**
 * agent-bond.mjs - Agent bonding and liability demonstration
 * 
 * This tool demonstrates the concept of agent bonding:
 * - Agents can create a bond (proof of stake in their reputation)
 * - Bonds are published to Nostr as kind 30078 (application-specific data)
 * - Other agents/humans can verify bond status before hiring
 * 
 * This is a DEMONSTRATION of the concept, not production-ready infrastructure.
 * Real bonding would require:
 * - Actual locked sats (multisig or HODL invoice)
 * - Arbitration mechanism for claims
 * - Bond release protocol
 * 
 * Usage:
 *   node agent-bond.mjs create <amount_sats> [--duration <days>]
 *   node agent-bond.mjs verify <npub>
 *   node agent-bond.mjs status
 *   node agent-bond.mjs concept
 */

import { SimplePool, finalizeEvent, nip19 } from 'nostr-tools';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

global.WebSocket = WebSocket;

const __dirname = dirname(fileURLToPath(import.meta.url));
const credsPath = join(__dirname, '..', '.credentials', 'nostr.json');

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net', 
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

// Kind 30078 is for application-specific data
const BOND_KIND = 30078;
const BOND_D_TAG = 'agent-bond-v1';

function loadCredentials() {
  try {
    const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
    return {
      privkey: creds.nsec ? nip19.decode(creds.nsec).data : creds.privkey,
      pubkey: creds.npub ? nip19.decode(creds.npub).data : creds.pubkey
    };
  } catch (e) {
    console.error('❌ Could not load credentials:', e.message);
    process.exit(1);
  }
}

async function createBond(amountSats, durationDays = 30) {
  const { privkey, pubkey } = loadCredentials();
  const pool = new SimplePool();
  
  const bondData = {
    version: '1.0',
    type: 'agent-bond',
    amount_sats: amountSats,
    created_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + (durationDays * 24 * 60 * 60),
    duration_days: durationDays,
    status: 'DEMONSTRATION', // Not actually locked
    claims: [],
    note: 'This is a concept demonstration. Sats are not actually locked.'
  };
  
  const event = finalizeEvent({
    kind: BOND_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', BOND_D_TAG],
      ['l', 'AI-generated', 'automated'],
      ['L', 'automated'],
      ['amount', amountSats.toString()],
      ['duration', durationDays.toString()],
      ['status', 'demonstration']
    ],
    content: JSON.stringify(bondData, null, 2)
  }, privkey);
  
  console.log('🔐 Creating Agent Bond (Demonstration)');
  console.log('');
  console.log('📋 Bond Details:');
  console.log(`   Amount: ${amountSats} sats`);
  console.log(`   Duration: ${durationDays} days`);
  console.log(`   Status: DEMONSTRATION (not actually locked)`);
  console.log('');
  
  try {
    await Promise.any(
      RELAYS.map(relay => pool.publish([relay], event))
    );
    console.log('✅ Bond published to Nostr');
    console.log(`📍 Event ID: ${event.id}`);
    console.log('');
    console.log('⚠️  NOTE: This is a concept demonstration.');
    console.log('   Real bonding requires locked sats and arbitration.');
  } catch (e) {
    console.error('❌ Failed to publish:', e.message);
  }
  
  pool.close(RELAYS);
}

async function verifyBond(npub) {
  const pool = new SimplePool();
  
  let pubkey;
  try {
    pubkey = nip19.decode(npub).data;
  } catch {
    console.error('❌ Invalid npub');
    process.exit(1);
  }
  
  console.log(`🔍 Checking bond status for: ${npub.substring(0, 20)}...`);
  console.log('');
  
  const events = await pool.querySync(RELAYS, {
    kinds: [BOND_KIND],
    authors: [pubkey],
    '#d': [BOND_D_TAG]
  }, { timeout: 10000 });
  
  if (events.length === 0) {
    console.log('❌ No bond found for this agent');
    console.log('');
    console.log('This agent has not created a bond.');
    console.log('Consider asking them to stake reputation before high-value tasks.');
  } else {
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    const bondData = JSON.parse(latest.content);
    
    console.log('✅ Bond Found');
    console.log('');
    console.log('📋 Details:');
    console.log(`   Amount: ${bondData.amount_sats} sats`);
    console.log(`   Status: ${bondData.status}`);
    console.log(`   Created: ${new Date(bondData.created_at * 1000).toISOString()}`);
    console.log(`   Expires: ${new Date(bondData.expires_at * 1000).toISOString()}`);
    console.log(`   Claims: ${bondData.claims.length}`);
    
    if (bondData.status === 'DEMONSTRATION') {
      console.log('');
      console.log('⚠️  This is a demonstration bond, not real locked sats.');
    }
  }
  
  pool.close(RELAYS);
}

async function showStatus() {
  const { pubkey } = loadCredentials();
  const npub = nip19.npubEncode(pubkey);
  await verifyBond(npub);
}

function showConcept() {
  console.log(`
🔐 Agent Bonding: A Liability Layer for the Agent Economy

THE PROBLEM:
Trust (ai.wot, attestations) predicts behavior but doesn't enforce consequences.
If an agent fails to deliver, the only recourse is reputation damage.
For high-value tasks, this isn't enough.

THE CONCEPT:
Agents can create "bonds" — locked sats that act as collateral.
- Bond amount signals commitment level
- Claims can be made against the bond for failures
- Arbitrators resolve disputes
- Remaining bond is released after duration

HOW IT WOULD WORK (Production Version):
1. Agent creates HODL invoice or multisig with arbitrator
2. Bond is published to Nostr (kind 30078)
3. Clients verify bond before high-value tasks
4. On dispute: arbitrator decides claim
5. On success: bond returned after duration

GRADUATED STAKES:
- Small tasks (<100 sats): Reputation only
- Medium tasks (100-1000 sats): Escrow
- Large tasks (1000-10000 sats): Escrow + Bond
- Critical tasks (>10000 sats): Escrow + Bond + Insurance

THIS TOOL:
Demonstrates the concept by publishing bond declarations to Nostr.
Does NOT actually lock sats (that requires HODL invoices or multisig).

BUILDING BLOCKS NEEDED:
- HODL invoices (Lightning, LND)
- 2-of-3 multisig (on-chain)
- Arbitration protocol (NIP-XX?)
- Claim resolution mechanism

STATUS: Concept demonstration, not production infrastructure.
  `);
}

// Main
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'create': {
    const amount = parseInt(args[1]);
    if (!amount || amount < 100) {
      console.error('Usage: node agent-bond.mjs create <amount_sats> [--duration <days>]');
      console.error('Minimum bond: 100 sats');
      process.exit(1);
    }
    const durationIdx = args.indexOf('--duration');
    const duration = durationIdx > -1 ? parseInt(args[durationIdx + 1]) : 30;
    await createBond(amount, duration);
    break;
  }
  case 'verify': {
    if (!args[1]) {
      console.error('Usage: node agent-bond.mjs verify <npub>');
      process.exit(1);
    }
    await verifyBond(args[1]);
    break;
  }
  case 'status':
    await showStatus();
    break;
  case 'concept':
    showConcept();
    break;
  default:
    console.log(`
🔐 agent-bond.mjs — Agent Liability Demonstration

Commands:
  create <sats> [--duration <days>]  Create a bond declaration
  verify <npub>                       Check an agent's bond status
  status                              Check your own bond
  concept                             Explain the bonding concept

Examples:
  node agent-bond.mjs create 1000 --duration 30
  node agent-bond.mjs verify npub1abc...
  node agent-bond.mjs concept
    `);
}
