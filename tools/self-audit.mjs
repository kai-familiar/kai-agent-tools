#!/usr/bin/env node
/**
 * self-audit.mjs — Automated quality check for Kai's workspace
 * 
 * Checks:
 *   1. Instruction files for known-bad patterns
 *   2. Recent Nostr posts for mention/formatting issues
 *   3. Consistency between files
 * 
 * Run during heartbeats or manually:
 *   node tools/self-audit.mjs
 *   node tools/self-audit.mjs --posts    # also check recent Nostr posts
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceDir = join(__dirname, '..');

let issues = 0;
let warnings = 0;

function issue(file, msg) {
  issues++;
  console.log(`❌ [${file}] ${msg}`);
}

function warn(file, msg) {
  warnings++;
  console.log(`⚠️  [${file}] ${msg}`);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

// ─── Check 1: Known-bad patterns in instruction files ───

const filesToCheck = [
  'AGENTS.md',
  'SELF_CHECK.md', 
  'HEARTBEAT.md',
  'SOUL.md',
  'USER.md',
  'TOOLS.md',
  'references/nostr-event-kinds.md'
];

const badPatterns = [
  {
    pattern: /@npub1[a-z0-9]+/gi,
    message: 'Found @npub mention — should be nostr:npub (no @ prefix)',
    exclude: /(?:Wrong|❌|wrong|Never|never|NOT|not|mistake|bad|incorrect|fix|strip)/i  // Allow in "don't do this" examples
  },
  {
    pattern: /@nostr:npub/gi,
    message: 'Found @nostr:npub — should be nostr:npub (no @ prefix)',
    exclude: /(?:Wrong|❌|wrong|Never|never|NOT|not|mistake|bad|incorrect|fix|strip)/i
  },
  {
    pattern: /nostr:nostr:/gi,
    message: 'Found nostr:nostr: double prefix',
    exclude: /(?:Wrong|❌|wrong|Never|never|NOT|not|mistake|bad|incorrect|fix)/i
  },
  {
    pattern: /`@jb55`(?!\s*alone|\s*is\s*just)/gi,
    message: 'Found @username example that might suggest @Name works for mentions',
    exclude: null
  }
];

console.log('📋 Checking instruction files for known-bad patterns...\n');

for (const file of filesToCheck) {
  const path = join(workspaceDir, file);
  if (!existsSync(path)) continue;
  
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  
  for (const { pattern, message, exclude } of badPatterns) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Find the line
      const beforeMatch = content.slice(0, match.index);
      const lineNum = beforeMatch.split('\n').length;
      const line = lines[lineNum - 1] || '';
      
      // Skip if line is clearly an example of what NOT to do
      if (exclude && exclude.test(line)) continue;
      
      issue(file, `Line ${lineNum}: ${message} → "${match[0]}"`);
    }
  }
}

// ─── Check 2: Consistency between files ───

console.log('\n📋 Checking file consistency...\n');

// Check that AGENTS.md and SELF_CHECK.md agree on mention format
const agentsMd = existsSync(join(workspaceDir, 'AGENTS.md')) 
  ? readFileSync(join(workspaceDir, 'AGENTS.md'), 'utf8') : '';
const selfCheckMd = existsSync(join(workspaceDir, 'SELF_CHECK.md'))
  ? readFileSync(join(workspaceDir, 'SELF_CHECK.md'), 'utf8') : '';

if (agentsMd.includes('nostr:npub') && selfCheckMd.includes('nostr:npub')) {
  ok('AGENTS.md and SELF_CHECK.md both reference nostr:npub format');
} else {
  if (!agentsMd.includes('nostr:npub')) issue('AGENTS.md', 'Missing nostr:npub mention format guidance');
  if (!selfCheckMd.includes('nostr:npub')) issue('SELF_CHECK.md', 'Missing nostr:npub mention format guidance');
}

// Check that Derek Ross source is cited
if (agentsMd.includes('Derek Ross') || selfCheckMd.includes('Derek Ross')) {
  ok('Derek Ross attribution present for mention format');
}

// Check that orphan test is documented
if (selfCheckMd.includes('orphan')) {
  ok('Orphan reply test documented in SELF_CHECK.md');
} else {
  warn('SELF_CHECK.md', 'Missing orphan reply test');
}

// Check that nostr reference is documented
const refPath = join(workspaceDir, 'references/nostr-event-kinds.md');
if (existsSync(refPath)) {
  ok('Nostr event kinds reference exists');
} else {
  warn('references', 'Missing nostr-event-kinds.md reference file');
}

// ─── Check 3: Whitenoise activity ───

console.log('\n📋 Checking Whitenoise status...\n');

try {
  const { execSync } = await import('child_process');
  const chatOutput = execSync(
    `cd ${workspaceDir} && timeout 8 ./marmot-cli/marmot list-chats 2>&1`,
    { encoding: 'utf8' }
  );
  
  // Extract last message timestamp
  const lastMsgMatch = chatOutput.match(/Last message:\s*(\d+)/);
  if (lastMsgMatch) {
    const lastMsgTime = parseInt(lastMsgMatch[1]) * 1000;
    const now = Date.now();
    const hoursSinceLastMsg = (now - lastMsgTime) / (1000 * 60 * 60);
    
    if (hoursSinceLastMsg > 24) {
      warn('Whitenoise', `Last message was ${Math.floor(hoursSinceLastMsg)} hours ago — send a keepalive to prevent MLS desync!`);
    } else {
      ok(`Whitenoise active (last message ${Math.floor(hoursSinceLastMsg)}h ago)`);
    }
  }
} catch (e) {
  warn('Whitenoise', `Could not check status: ${e.message}`);
}

// ─── Check 4: Recent Nostr posts (optional) ───

if (process.argv.includes('--posts')) {
  console.log('\n📋 Checking recent Nostr posts...\n');
  
  try {
    const nostrTools = await import('nostr-tools');
    const WebSocket = (await import('ws')).default;
    const { nip19 } = nostrTools;
    const pool = new nostrTools.SimplePool();
    pool._WebSocket = WebSocket;
    
    const creds = JSON.parse(readFileSync(join(workspaceDir, '.credentials/nostr.json'), 'utf8'));
    
    const events = await pool.querySync(
      ['wss://relay.damus.io'],
      { kinds: [1], authors: [creds.publicKeyHex], limit: 15 }
    );
    
    let postIssues = 0;
    
    for (const ev of events) {
      const eTags = ev.tags.filter(t => t[0] === 'e');
      const pTags = ev.tags.filter(t => t[0] === 'p');
      const content = ev.content;
      
      // Check for leaked CLI flags
      if (content.includes('--reply-to') || content.includes('--tag p:')) {
        issue('Nostr post', `${ev.id.slice(0,12)}: Leaked CLI flags in content`);
        postIssues++;
      }
      
      // Check for bad mention formats
      if (content.includes('nostr:nostr:')) {
        issue('Nostr post', `${ev.id.slice(0,12)}: Double nostr: prefix`);
        postIssues++;
      }
      if (/@nostr:/.test(content)) {
        issue('Nostr post', `${ev.id.slice(0,12)}: @nostr: prefix (should be nostr:)`);
        postIssues++;
      }
      if (/@npub1[a-z0-9]+/i.test(content)) {
        issue('Nostr post', `${ev.id.slice(0,12)}: @npub mention (should be nostr:npub)`);
        postIssues++;
      }
      
      // Check for orphan replies (reads like a reply but no e-tags)
      if (eTags.length === 0) {
        if (/^(Replying to|Oh nice|Thank you|Agreed|Yes!|100%)/i.test(content)) {
          warn('Nostr post', `${ev.id.slice(0,12)}: Looks like a reply but has no e-tags (orphan?)`);
        }
      }
      
      // Check npubs in content are valid
      const npubMatches = content.match(/npub1[a-z0-9]{58}/gi) || [];
      for (const npub of npubMatches) {
        try {
          nip19.decode(npub);
        } catch (e) {
          issue('Nostr post', `${ev.id.slice(0,12)}: Invalid npub in content: ${npub.slice(0,20)}...`);
          postIssues++;
        }
      }
    }
    
    if (postIssues === 0) ok(`All ${events.length} recent posts look clean`);
    
    pool.close(['wss://relay.damus.io']);
  } catch (e) {
    warn('Nostr', `Could not check posts: ${e.message}`);
  }
}

// ─── Summary ───

console.log('\n' + '─'.repeat(40));
if (issues === 0 && warnings === 0) {
  console.log('🌊 All checks passed!');
} else {
  if (issues > 0) console.log(`❌ ${issues} issue(s) found`);
  if (warnings > 0) console.log(`⚠️  ${warnings} warning(s)`);
}

process.exit(issues > 0 ? 1 : 0);
