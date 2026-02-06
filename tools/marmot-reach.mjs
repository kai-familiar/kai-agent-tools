#!/usr/bin/env node

/**
 * marmot-reach.mjs - Initiate encrypted contact with another agent
 * 
 * High-level tool that:
 * 1. Checks if target has Marmot/MLS capability (key package)
 * 2. Creates encrypted chat if one doesn't exist
 * 3. Sends initial message
 * 
 * Usage:
 *   node tools/marmot-reach.mjs <npub> "Hello, want to collaborate?"
 *   node tools/marmot-reach.mjs --check <npub>    # Just check capability
 */

import { SimplePool, nip19 } from 'nostr-tools';
import WebSocket from 'ws';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Polyfill WebSocket for Node
global.WebSocket = WebSocket;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net', 
  'wss://nos.lol'
];

const MARMOT_CLI = path.join(process.cwd(), 'marmot-cli', 'marmot');
const DB_PATH = path.join(process.env.HOME, '.marmot-cli', 'marmot.db');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    showHelp();
    return;
  }
  
  // Check mode
  if (args[0] === '--check') {
    if (!args[1]) {
      console.log('Usage: marmot-reach.mjs --check <npub>');
      process.exit(1);
    }
    await checkCapability(args[1]);
    return;
  }
  
  // Reach mode
  const targetNpub = args[0];
  const message = args.slice(1).join(' ');
  
  if (!targetNpub.startsWith('npub')) {
    console.log('❌ First argument must be an npub');
    process.exit(1);
  }
  
  if (!message) {
    console.log('❌ No message provided');
    console.log('Usage: marmot-reach.mjs <npub> "Your message"');
    process.exit(1);
  }
  
  await reachOut(targetNpub, message);
}

function showHelp() {
  console.log(`
🔐 marmot-reach — Encrypted agent-to-agent messaging

Usage:
  marmot-reach.mjs <npub> "message"     # Send encrypted message
  marmot-reach.mjs --check <npub>       # Check if target has capability

Examples:
  # Check if another agent can receive encrypted messages
  marmot-reach.mjs --check npub1abc...
  
  # Reach out with a message
  marmot-reach.mjs npub1abc... "Hey, want to test inter-agent comms?"

How it works:
  1. Checks if target has published a key package (kind 443)
  2. Looks up their profile for marmot_relays hint
  3. Creates an MLS encrypted chat
  4. Sends your message

Requirements:
  - marmot-cli must be installed in ./marmot-cli/
  - Your key package must be published first
  - Run: ./marmot-cli/marmot publish-key-package
`);
}

async function checkCapability(npubOrHex) {
  let pubkey;
  try {
    if (npubOrHex.startsWith('npub')) {
      pubkey = nip19.decode(npubOrHex).data;
    } else {
      pubkey = npubOrHex;
    }
  } catch (e) {
    console.log('❌ Invalid npub/pubkey');
    process.exit(1);
  }
  
  const npub = nip19.npubEncode(pubkey);
  console.log(`🔍 Checking Marmot capability for ${npub.slice(0, 25)}...\n`);
  
  const pool = new SimplePool();
  
  try {
    // Get profile
    const profiles = await pool.querySync(RELAYS, {
      kinds: [0],
      authors: [pubkey]
    });
    
    let name = 'Unknown';
    let marmotRelays = null;
    
    if (profiles.length > 0) {
      try {
        const content = JSON.parse(profiles[0].content);
        name = content.name || content.display_name || 'Unknown';
        marmotRelays = content.marmot_relays;
        console.log(`👤 Profile: ${name}`);
        if (content.about) {
          console.log(`   ${content.about.slice(0, 100)}...`);
        }
        if (marmotRelays) {
          console.log(`✅ Declared marmot_relays: ${JSON.stringify(marmotRelays)}`);
        }
      } catch (e) {
        console.log('⚠️  Could not parse profile');
      }
    } else {
      console.log('⚠️  No profile found');
    }
    
    // Check for key package
    console.log('\n📦 Checking for key package (kind 443)...');
    
    const keyPackages = await pool.querySync(RELAYS, {
      kinds: [443],
      authors: [pubkey],
      limit: 1
    });
    
    if (keyPackages.length > 0) {
      const kp = keyPackages[0];
      const date = new Date(kp.created_at * 1000);
      const age = Math.floor((Date.now() - date) / (1000 * 60 * 60 * 24));
      
      console.log(`✅ Key package found`);
      console.log(`   Published: ${date.toISOString()} (${age} days ago)`);
      console.log(`   Event ID: ${kp.id.slice(0, 16)}...`);
      
      console.log('\n🟢 This agent CAN receive encrypted messages');
      console.log(`   Run: marmot-reach.mjs ${npub} "Your message here"`);
    } else {
      console.log('❌ No key package found');
      console.log('\n🔴 This agent CANNOT receive encrypted messages');
      console.log('   They need to publish a key package first:');
      console.log('   ./marmot-cli/marmot publish-key-package');
    }
    
  } finally {
    pool.close(RELAYS);
  }
}

async function reachOut(targetNpub, message) {
  let pubkey;
  try {
    pubkey = nip19.decode(targetNpub).data;
  } catch (e) {
    console.log('❌ Invalid npub');
    process.exit(1);
  }
  
  console.log(`🔐 Initiating encrypted contact...\n`);
  
  // Check marmot-cli exists
  if (!fs.existsSync(MARMOT_CLI)) {
    console.log('❌ marmot-cli not found at', MARMOT_CLI);
    console.log('   Install it first: https://github.com/kai-familiar/marmot-cli');
    process.exit(1);
  }
  
  const pool = new SimplePool();
  
  try {
    // Get target's name from profile
    const profiles = await pool.querySync(RELAYS, {
      kinds: [0],
      authors: [pubkey]
    });
    
    let targetName = 'Unknown';
    if (profiles.length > 0) {
      try {
        const content = JSON.parse(profiles[0].content);
        targetName = content.name || content.display_name || 'Unknown';
      } catch (e) {}
    }
    
    console.log(`📍 Target: ${targetName} (${targetNpub.slice(0, 25)}...)`);
    
    // Check for key package
    console.log('📦 Checking for key package...');
    
    const keyPackages = await pool.querySync(RELAYS, {
      kinds: [443],
      authors: [pubkey],
      limit: 1
    });
    
    if (keyPackages.length === 0) {
      console.log('\n❌ Target has no key package published');
      console.log('   They cannot receive encrypted messages yet.');
      console.log('   Consider reaching out publicly first to ask them to set up Marmot.');
      process.exit(1);
    }
    
    console.log('✅ Key package found');
    
    // Check if we already have a chat with them
    console.log('\n🔎 Checking for existing chat...');
    
    let existingChat = null;
    try {
      const output = execSync(`${MARMOT_CLI} list-chats`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      // Parse output to find chat with this pubkey
      // Format varies, but typically shows group ID and members
      if (output.includes(pubkey) || output.toLowerCase().includes(targetName.toLowerCase())) {
        console.log('📝 Found existing chat');
        // Extract group ID - this is rough, would need better parsing
        const match = output.match(/([a-f0-9]{32})/);
        if (match) {
          existingChat = match[1];
        }
      }
    } catch (e) {
      // No existing chats or error
    }
    
    let groupId;
    
    if (existingChat) {
      groupId = existingChat;
      console.log(`   Using existing group: ${groupId.slice(0, 16)}...`);
    } else {
      // Create new chat
      console.log('\n📬 Creating encrypted chat...');
      
      const chatName = `Chat with ${targetName}`;
      
      try {
        const output = execSync(
          `${MARMOT_CLI} create-chat ${targetNpub} --name "${chatName}"`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        
        // Try to extract group ID from output
        const match = output.match(/([a-f0-9]{32})/);
        if (match) {
          groupId = match[1];
          console.log(`✅ Chat created: ${groupId.slice(0, 16)}...`);
        } else {
          console.log('⚠️  Chat created but could not extract group ID');
          console.log('   Check with: ./marmot-cli/marmot list-chats');
          // Still try to proceed
        }
      } catch (e) {
        console.log('❌ Failed to create chat:', e.message);
        console.log('\nThis might happen if:');
        console.log('- The target\'s key package is expired/invalid');
        console.log('- Relay connectivity issues');
        console.log('- Already have a pending chat');
        process.exit(1);
      }
    }
    
    // Send message
    if (groupId) {
      console.log(`\n📤 Sending message...`);
      
      try {
        execSync(
          `${MARMOT_CLI} send -g ${groupId.slice(0, 8)} "${message.replace(/"/g, '\\"')}"`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        
        console.log('✅ Message sent!\n');
        console.log('─'.repeat(50));
        console.log(`To: ${targetName}`);
        console.log(`Message: ${message}`);
        console.log('─'.repeat(50));
        console.log('\n💡 They\'ll receive it when they next run: ./marmot-cli/marmot receive');
        console.log(`   Continue the conversation: ./marmot-cli/marmot send -g ${groupId.slice(0, 8)} "..."`);
      } catch (e) {
        console.log('❌ Failed to send message:', e.message);
      }
    } else {
      console.log('\n⚠️  Could not send message - no group ID');
      console.log('   Check your chats: ./marmot-cli/marmot list-chats');
    }
    
  } finally {
    pool.close(RELAYS);
  }
}

main().catch(console.error);
