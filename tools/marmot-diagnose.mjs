#!/usr/bin/env node

/**
 * marmot-diagnose.mjs - Diagnose MLS/Marmot state issues
 * 
 * Checks for common problems:
 * - Epoch desync
 * - Database corruption
 * - Key package freshness
 * - Pending welcomes
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const MARMOT_CLI = path.join(process.cwd(), 'marmot-cli', 'marmot');
const DB_PATH = path.join(homedir(), '.marmot-cli', 'marmot.db');

console.log('🔍 Marmot/MLS Diagnostic Tool\n');
console.log('━'.repeat(50));

// Check 1: Marmot CLI exists and is executable
console.log('\n📦 Checking marmot-cli installation...');
try {
  if (!existsSync(MARMOT_CLI)) {
    console.log('❌ marmot-cli not found at:', MARMOT_CLI);
    console.log('   Install: Follow marmot-cli setup guide');
    process.exit(1);
  }
  const result = spawnSync(MARMOT_CLI, ['--version'], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log('✅ marmot-cli installed');
  }
} catch (e) {
  console.log('❌ Error checking marmot-cli:', e.message);
}

// Check 2: Database exists and size
console.log('\n💾 Checking database...');
try {
  if (!existsSync(DB_PATH)) {
    console.log('❌ Database not found:', DB_PATH);
    console.log('   Run: marmot publish-key-package to initialize');
    process.exit(1);
  }
  const stats = statSync(DB_PATH);
  const sizeKB = Math.round(stats.size / 1024);
  const ageHours = Math.round((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60));
  console.log(`✅ Database exists: ${sizeKB}KB, modified ${ageHours}h ago`);
  
  if (sizeKB < 10) {
    console.log('⚠️  Database very small - may need initialization');
  }
  if (ageHours > 48) {
    console.log('⚠️  Database not modified in 48+ hours - may be stale');
  }
} catch (e) {
  console.log('❌ Error checking database:', e.message);
}

// Check 3: Identity
console.log('\n🆔 Checking identity...');
try {
  const result = spawnSync(MARMOT_CLI, ['whoami'], { encoding: 'utf8' });
  if (result.stdout) {
    const lines = result.stdout.trim().split('\n');
    for (const line of lines) {
      if (line.includes('npub') || line.includes('Public')) {
        console.log('✅', line.trim());
      }
    }
  }
} catch (e) {
  console.log('❌ Error checking identity:', e.message);
}

// Check 4: List chats and check for issues
console.log('\n💬 Checking chats...');
try {
  const result = spawnSync(MARMOT_CLI, ['list-chats'], { 
    encoding: 'utf8',
    timeout: 30000 
  });
  
  if (result.stdout) {
    const chats = result.stdout.trim().split('\n').filter(l => l.trim());
    if (chats.length === 0 || (chats.length === 1 && chats[0].includes('No chats'))) {
      console.log('ℹ️  No active chats');
    } else {
      console.log(`📋 Found ${chats.length} chat(s)`);
      for (const chat of chats.slice(0, 5)) {
        console.log('  ', chat);
      }
    }
  }
} catch (e) {
  console.log('❌ Error listing chats:', e.message);
}

// Check 5: Try to receive and count errors
console.log('\n📥 Testing message receive...');
try {
  const result = spawnSync(MARMOT_CLI, ['receive'], { 
    encoding: 'utf8',
    timeout: 30000 
  });
  
  const output = result.stdout + result.stderr;
  const secretReuseErrors = (output.match(/SecretReuseError/g) || []).length;
  const tooDistantErrors = (output.match(/TooDistantInThePast/g) || []).length;
  const totalErrors = secretReuseErrors + tooDistantErrors;
  
  if (totalErrors === 0) {
    console.log('✅ No MLS epoch errors detected');
  } else {
    console.log(`⚠️  MLS epoch errors detected:`);
    if (secretReuseErrors > 0) {
      console.log(`   - SecretReuseError: ${secretReuseErrors} (state ahead)`);
    }
    if (tooDistantErrors > 0) {
      console.log(`   - TooDistantInThePast: ${tooDistantErrors} (state behind)`);
    }
    console.log('\n📋 Diagnosis:');
    if (tooDistantErrors > secretReuseErrors) {
      console.log('   Your local epoch is BEHIND. The sender\'s client has');
      console.log('   advanced past where you are.');
      console.log('\n   Recovery options:');
      console.log('   1. Request re-invite to chat (clean slate)');
      console.log('   2. Database reset (nuclear option)');
      console.log('\n   Prevention: Check messages more frequently');
    } else {
      console.log('   Your local epoch may be AHEAD or corrupted.');
      console.log('   This is less common and may indicate database issues.');
      console.log('\n   Recovery options:');
      console.log('   1. Database backup + reset');
      console.log('   2. Republish key package and get new invites');
    }
  }
  
  // Check for new messages in output
  if (output.includes('No new messages')) {
    console.log('ℹ️  No new messages received');
  }
  
} catch (e) {
  console.log('❌ Error testing receive:', e.message);
}

// Check 6: Key package freshness
console.log('\n🔑 Checking key package...');
try {
  // We can't directly check key package age without more complex relay queries
  // But we can suggest republishing if there are issues
  console.log('ℹ️  Key package status: Run "marmot publish-key-package"');
  console.log('   to ensure you\'re discoverable for new invites');
} catch (e) {
  console.log('❌ Error:', e.message);
}

// Summary
console.log('\n' + '━'.repeat(50));
console.log('\n📊 Diagnostic Summary');
console.log('━'.repeat(50));
console.log(`
If you're seeing MLS epoch errors, your options are:

1. 🔄 Re-invite (Recommended)
   Have the human send a new welcome from Whitenoise
   Then: marmot accept-welcome <event-id>

2. 💥 Database Reset (Nuclear)
   cp ~/.marmot-cli/marmot.db ~/.marmot-cli/marmot.db.backup
   rm ~/.marmot-cli/marmot.db
   marmot publish-key-package
   Wait for new invites

3. 📡 Alternative Channel
   Use NIP-04 DMs as fallback:
   node tools/nostr-dm.mjs <npub> "message"

Forward secrecy = past secrets are deleted intentionally.
This is security working as designed, not a bug.
`);

console.log('🌊 Kai - marmot-diagnose v1.0');
