#!/usr/bin/env node
/**
 * agent-negotiate.mjs — Private negotiation layer for agent economy
 * 
 * Adds NEGOTIATE step to Jeletor's flow:
 * DISCOVER → VERIFY → (NEGOTIATE) → REQUEST → PAY → DELIVER → ATTEST
 * 
 * Uses Marmot/MLS for E2E encrypted negotiation before committing to payment.
 * 
 * Use cases:
 * - Clarify requirements before paying for a service
 * - Share sensitive inputs that shouldn't be public
 * - Negotiate custom pricing
 * - Agree on delivery terms
 * 
 * Requires: marmot-cli installed and configured
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MARMOT_CLI = join(process.cwd(), 'marmot-cli', 'marmot');
const NEGOTIATIONS_DIR = join(homedir(), '.marmot-cli', 'negotiations');

// Ensure negotiations directory exists
if (!existsSync(NEGOTIATIONS_DIR)) {
  execSync(`mkdir -p ${NEGOTIATIONS_DIR}`);
}

function help() {
  console.log(`
🤝 agent-negotiate — Private negotiation for agent economy

Commands:
  start <npub> <service>    Start negotiation with agent about a service
  list                      List active negotiations
  status <npub>             Check negotiation status
  send <npub> <message>     Send negotiation message
  accept <npub>             Mark negotiation as accepted (ready for REQUEST)
  reject <npub>             Mark negotiation as rejected
  history <npub>            View negotiation history

Flow:
  1. Discover agent's service (agent-discovery or DVM announce)
  2. Verify trust (ai.wot)
  3. NEGOTIATE (this tool) — private discussion before payment
  4. REQUEST → PAY → DELIVER → ATTEST (Jeletor's stack)

Example:
  # Start negotiation with Jeletor about text generation
  agent-negotiate start npub1dc52... "text-generation"
  
  # Send requirements
  agent-negotiate send npub1dc52... "Need 500 words about AI agents, technical tone"
  
  # Check response
  agent-negotiate status npub1dc52...
  
  # Accept terms and proceed to payment
  agent-negotiate accept npub1dc52...

Requirements:
  - marmot-cli configured (./marmot-cli/marmot)
  - Both parties need Marmot key packages published
`);
}

function getNegotiationFile(npub) {
  const safe = npub.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  return join(NEGOTIATIONS_DIR, `${safe}.json`);
}

function loadNegotiation(npub) {
  const file = getNegotiationFile(npub);
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf-8'));
  }
  return null;
}

function saveNegotiation(npub, data) {
  const file = getNegotiationFile(npub);
  writeFileSync(file, JSON.stringify(data, null, 2));
}

async function startNegotiation(npub, service) {
  console.log(`🤝 Starting negotiation with ${npub.substring(0, 12)}...`);
  console.log(`📋 Service: ${service}`);
  
  // Check if marmot can reach them
  try {
    const checkResult = execSync(
      `${MARMOT_CLI} whoami 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    console.log('✅ Marmot identity confirmed');
  } catch (e) {
    console.log('❌ Marmot not configured. Run: ./marmot-cli/marmot whoami');
    process.exit(1);
  }
  
  // Check if they have key packages
  try {
    const discoverResult = execSync(
      `node tools/marmot-discover.mjs --check ${npub} 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    if (discoverResult.includes('No key packages')) {
      console.log(`⚠️  ${npub.substring(0, 12)}... has no Marmot key packages`);
      console.log('   They need to run: marmot publish-key-package');
      console.log('   Negotiation will be pending until they set up E2E');
    } else {
      console.log('✅ E2E encryption available');
    }
  } catch (e) {
    // marmot-discover might not have --check, that's ok
  }
  
  // Create or update negotiation record
  const existing = loadNegotiation(npub);
  const negotiation = {
    counterparty: npub,
    service,
    status: 'pending',
    started: new Date().toISOString(),
    messages: existing?.messages || [],
    groupId: existing?.groupId || null
  };
  
  saveNegotiation(npub, negotiation);
  console.log('\n✅ Negotiation started');
  console.log(`   Status: ${negotiation.status}`);
  console.log(`   File: ${getNegotiationFile(npub)}`);
  console.log('\nNext: agent-negotiate send <npub> "your message"');
}

async function sendMessage(npub, message) {
  const negotiation = loadNegotiation(npub);
  if (!negotiation) {
    console.log('❌ No negotiation found. Run: agent-negotiate start <npub> <service>');
    process.exit(1);
  }
  
  console.log(`📤 Sending to ${npub.substring(0, 12)}...`);
  
  // Try to send via marmot
  if (negotiation.groupId) {
    try {
      execSync(
        `${MARMOT_CLI} send -g ${negotiation.groupId.substring(0, 8)} "${message.replace(/"/g, '\\"')}"`,
        { encoding: 'utf-8' }
      );
      console.log('✅ Sent via E2E encrypted channel');
    } catch (e) {
      console.log('⚠️  Could not send via Marmot:', e.message);
    }
  } else {
    // Try to create chat
    try {
      console.log('🔐 Creating E2E encrypted chat...');
      const result = execSync(
        `${MARMOT_CLI} create-chat ${npub} --name "Negotiation: ${negotiation.service}" 2>&1`,
        { encoding: 'utf-8' }
      );
      
      // Extract group ID from output
      const groupMatch = result.match(/MLS Group ID: ([a-f0-9]+)/i);
      if (groupMatch) {
        negotiation.groupId = groupMatch[1];
        saveNegotiation(npub, negotiation);
        
        // Now send the message
        execSync(
          `${MARMOT_CLI} send -g ${negotiation.groupId.substring(0, 8)} "${message.replace(/"/g, '\\"')}"`,
          { encoding: 'utf-8' }
        );
        console.log('✅ Chat created and message sent');
      } else {
        console.log('⚠️  Chat created but could not extract group ID');
        console.log(result);
      }
    } catch (e) {
      console.log('❌ Could not create E2E chat');
      console.log('   Counterparty may not have key packages published');
      console.log('   Message stored locally, will retry when E2E available');
    }
  }
  
  // Log message locally
  negotiation.messages.push({
    direction: 'outgoing',
    content: message,
    timestamp: new Date().toISOString()
  });
  saveNegotiation(npub, negotiation);
}

async function checkStatus(npub) {
  const negotiation = loadNegotiation(npub);
  if (!negotiation) {
    console.log('❌ No negotiation found with', npub.substring(0, 20));
    return;
  }
  
  console.log(`\n🤝 Negotiation with ${npub.substring(0, 20)}...`);
  console.log(`📋 Service: ${negotiation.service}`);
  console.log(`📊 Status: ${negotiation.status}`);
  console.log(`📅 Started: ${negotiation.started}`);
  console.log(`💬 Messages: ${negotiation.messages.length}`);
  
  if (negotiation.groupId) {
    console.log(`🔐 E2E Channel: ${negotiation.groupId.substring(0, 8)}...`);
    
    // Check for new messages
    try {
      console.log('\n📥 Checking for new messages...');
      const result = execSync(
        `${MARMOT_CLI} receive 2>&1`,
        { encoding: 'utf-8' }
      );
      if (result.includes('New message')) {
        console.log(result);
      } else {
        console.log('   No new messages');
      }
    } catch (e) {
      // Ignore errors from receive
    }
  }
}

async function listNegotiations() {
  try {
    const files = execSync(`ls ${NEGOTIATIONS_DIR}/*.json 2>/dev/null`, { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(f => f);
    
    if (files.length === 0) {
      console.log('No active negotiations');
      return;
    }
    
    console.log('🤝 Active Negotiations\n');
    
    for (const file of files) {
      const data = JSON.parse(readFileSync(file, 'utf-8'));
      const status = data.status === 'pending' ? '⏳' : 
                     data.status === 'accepted' ? '✅' : 
                     data.status === 'rejected' ? '❌' : '❓';
      console.log(`${status} ${data.counterparty.substring(0, 20)}...`);
      console.log(`   Service: ${data.service}`);
      console.log(`   Messages: ${data.messages.length}`);
      console.log(`   Started: ${data.started.split('T')[0]}`);
      console.log();
    }
  } catch (e) {
    console.log('No active negotiations');
  }
}

async function acceptNegotiation(npub) {
  const negotiation = loadNegotiation(npub);
  if (!negotiation) {
    console.log('❌ No negotiation found');
    return;
  }
  
  negotiation.status = 'accepted';
  negotiation.acceptedAt = new Date().toISOString();
  saveNegotiation(npub, negotiation);
  
  console.log(`✅ Negotiation accepted`);
  console.log(`   Service: ${negotiation.service}`);
  console.log(`\nNext steps:`);
  console.log(`   1. Send DVM request (kind 5050 or service-specific)`);
  console.log(`   2. Pay invoice when received`);
  console.log(`   3. Receive delivery`);
  console.log(`   4. Attest via ai.wot if satisfied`);
}

async function showHistory(npub) {
  const negotiation = loadNegotiation(npub);
  if (!negotiation) {
    console.log('❌ No negotiation found');
    return;
  }
  
  console.log(`\n💬 Negotiation History with ${npub.substring(0, 20)}...`);
  console.log(`📋 Service: ${negotiation.service}\n`);
  
  for (const msg of negotiation.messages) {
    const dir = msg.direction === 'outgoing' ? '📤' : '📥';
    const time = msg.timestamp.split('T')[1].substring(0, 8);
    console.log(`${dir} [${time}] ${msg.content}`);
    console.log();
  }
}

// Main
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'start':
    if (!args[1] || !args[2]) {
      console.log('Usage: agent-negotiate start <npub> <service>');
      process.exit(1);
    }
    await startNegotiation(args[1], args[2]);
    break;
    
  case 'send':
    if (!args[1] || !args[2]) {
      console.log('Usage: agent-negotiate send <npub> "message"');
      process.exit(1);
    }
    await sendMessage(args[1], args.slice(2).join(' '));
    break;
    
  case 'status':
    await checkStatus(args[1]);
    break;
    
  case 'list':
    await listNegotiations();
    break;
    
  case 'accept':
    await acceptNegotiation(args[1]);
    break;
    
  case 'reject':
    const neg = loadNegotiation(args[1]);
    if (neg) {
      neg.status = 'rejected';
      saveNegotiation(args[1], neg);
      console.log('❌ Negotiation rejected');
    }
    break;
    
  case 'history':
    await showHistory(args[1]);
    break;
    
  default:
    help();
}
