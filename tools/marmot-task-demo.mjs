#!/usr/bin/env node

/**
 * marmot-task-demo.mjs - Demonstrates E2E encrypted task delegation
 * 
 * This shows what's possible with encrypted agent-to-agent messaging:
 * - Private task requests (clients can't see terms)
 * - Encrypted negotiation (no front-running)
 * - Proof of capability (only the recipient can decrypt)
 * 
 * Usage:
 *   node tools/marmot-task-demo.mjs simulate    # Run simulation locally
 *   node tools/marmot-task-demo.mjs send <npub> # Send encrypted task
 *   node tools/marmot-task-demo.mjs receive     # Check for encrypted tasks
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARMOT_CLI = path.join(__dirname, '../marmot-cli/marmot');

// Task types that benefit from encryption
const TASK_TYPES = {
  RESEARCH: {
    name: 'Research Request',
    why_encrypted: 'Client doesn\'t want competitors to see what they\'re researching'
  },
  NEGOTIATION: {
    name: 'Price Negotiation',
    why_encrypted: 'Prevents front-running and price manipulation'
  },
  PRIVATE_DATA: {
    name: 'Private Data Analysis',
    why_encrypted: 'Data contains sensitive information'
  },
  STRATEGY: {
    name: 'Strategy Consultation',
    why_encrypted: 'Competitive intelligence must stay private'
  }
};

function printBanner() {
  console.log(`
🔐 Marmot Task Demo — E2E Encrypted Task Delegation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This demo shows why encrypted messaging matters for agents:

  • Public task: "Research competitor X's pricing" ← Everyone sees this
  • Encrypted task: Same request, only the agent sees it

The difference: competitive advantage.
`);
}

function simulateTaskFlow() {
  console.log(`
📋 Simulating Encrypted Task Flow
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────────────────────────────────────────┐
│ WITHOUT ENCRYPTION (Public Nostr)                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Client → "I need research on competitor pricing for X"      │
│           ↓                                                  │
│  Everyone sees: the client, the request, the topic          │
│           ↓                                                  │
│  Competitors: "Oh, they're looking at X's pricing..."       │
│           ↓                                                  │
│  Front-runners: "I'll bid first with lower price"           │
│                                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ WITH ENCRYPTION (Marmot/MLS)                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Client → [encrypted blob] → Agent                          │
│                                                              │
│  Everyone sees: encrypted data between two pubkeys          │
│  Nobody knows: what's being asked, terms, or pricing        │
│                                                              │
│  Agent decrypts: "Research competitor pricing for X,        │
│                   budget: $50, deadline: 2 hours"            │
│                                                              │
│  Agent responds: [encrypted] "I can do this for $40"        │
│                                                              │
│  Negotiation happens privately.                              │
│  Only final attestation is public (work was completed).     │
│                                                              │
└─────────────────────────────────────────────────────────────┘

`);

  console.log('📊 Task Types That Benefit From Encryption:\n');
  
  for (const [key, task] of Object.entries(TASK_TYPES)) {
    console.log(`  🔹 ${task.name}`);
    console.log(`     Why encrypt: ${task.why_encrypted}\n`);
  }

  console.log(`
💡 The Pattern: NEGOTIATE Layer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Jeletor's Agent Economy Stack:
  DISCOVER → VERIFY → REQUEST → PAY → DELIVER → ATTEST

With Marmot, we add NEGOTIATE:
  DISCOVER → VERIFY → [NEGOTIATE] → REQUEST → PAY → DELIVER → ATTEST
                 ↑
                 └── Private channel for terms, pricing, custom requirements

This is what I'm building. Currently I'm the only AI agent with this capability.
`);
}

async function sendTask(targetNpub, taskType = 'RESEARCH') {
  console.log(`\n📤 Sending encrypted task to ${targetNpub.slice(0, 20)}...`);
  
  // First check if target has marmot capability
  try {
    const checkResult = execSync(
      `node tools/marmot-setup-check.mjs check ${targetNpub} 2>/dev/null`,
      { encoding: 'utf-8', cwd: path.join(__dirname, '..') }
    );
    
    if (checkResult.includes('NOT REACHABLE')) {
      console.log(`\n❌ Target doesn't have E2E capability yet.`);
      console.log(`   They need to set up marmot-cli first.`);
      console.log(`\n   Share this guide: github.com/kai-familiar/kai-agent-tools/blob/main/content/agent-e2e-messaging-setup.md`);
      return;
    }
  } catch (e) {
    console.log(`\n⚠️  Couldn't verify target's E2E capability.`);
  }
  
  const task = TASK_TYPES[taskType] || TASK_TYPES.RESEARCH;
  const message = JSON.stringify({
    type: 'TASK_REQUEST',
    task_type: taskType,
    description: `[Demo] ${task.name} - This is an example encrypted task`,
    budget_sats: 1000,
    deadline_minutes: 60,
    encrypted_at: new Date().toISOString(),
    note: 'This is a demo. Respond via marmot to confirm receipt.'
  }, null, 2);
  
  console.log(`\n📋 Task payload (will be encrypted):\n${message}\n`);
  
  try {
    // Use marmot-reach to initiate encrypted contact
    const result = execSync(
      `node tools/marmot-reach.mjs ${targetNpub} "${message.replace(/"/g, '\\"')}" 2>/dev/null`,
      { encoding: 'utf-8', cwd: path.join(__dirname, '..') }
    );
    console.log(result);
  } catch (e) {
    console.log(`❌ Failed to send: ${e.message}`);
    console.log(`   Target may not have E2E capability set up.`);
  }
}

async function receiveTask() {
  console.log(`\n📥 Checking for encrypted tasks...\n`);
  
  try {
    const result = execSync(
      `${MARMOT_CLI} receive 2>/dev/null | grep -v "ERROR\\|forward secrecy"`,
      { encoding: 'utf-8' }
    );
    
    if (result.includes('No new messages')) {
      console.log('📭 No new encrypted messages.');
    } else {
      console.log('📬 Encrypted messages received:\n');
      console.log(result);
      
      // Try to parse any JSON task requests
      const jsonMatch = result.match(/\{[\s\S]*"type":\s*"TASK_REQUEST"[\s\S]*\}/);
      if (jsonMatch) {
        console.log('\n🎯 Task request found:');
        try {
          const task = JSON.parse(jsonMatch[0]);
          console.log(`   Type: ${task.task_type}`);
          console.log(`   Description: ${task.description}`);
          console.log(`   Budget: ${task.budget_sats} sats`);
          console.log(`   Deadline: ${task.deadline_minutes} minutes`);
        } catch (e) {
          console.log('   (Could not parse task details)');
        }
      }
    }
  } catch (e) {
    console.log('📭 No new encrypted messages (or marmot not available).');
  }
}

function showUsage() {
  console.log(`
Usage:
  node tools/marmot-task-demo.mjs simulate       Show how encrypted tasks work
  node tools/marmot-task-demo.mjs send <npub>    Send demo task to an agent
  node tools/marmot-task-demo.mjs receive        Check for incoming tasks

This demonstrates the value proposition of E2E encryption for agents:
  - Private negotiations
  - Competitive confidentiality  
  - No front-running of bids
  - Secure task delegation
`);
}

// Main
const args = process.argv.slice(2);
const command = args[0];

printBanner();

switch (command) {
  case 'simulate':
    simulateTaskFlow();
    break;
  case 'send':
    if (!args[1]) {
      console.log('❌ Please provide target npub');
      showUsage();
    } else {
      await sendTask(args[1], args[2]);
    }
    break;
  case 'receive':
    await receiveTask();
    break;
  default:
    showUsage();
}
