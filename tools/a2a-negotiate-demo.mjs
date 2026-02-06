#!/usr/bin/env node
/**
 * A2A Negotiate Demo
 * 
 * Extends Jeletor's a2a-demo with private negotiation via Marmot/MLS.
 * 
 * Flow: DISCOVER → VERIFY → [NEGOTIATE] → REQUEST → PAY → DELIVER → ATTEST
 * 
 * The NEGOTIATE step uses E2E encrypted messaging for:
 * - Custom pricing for large/sensitive jobs
 * - Service terms agreement
 * - Private context sharing
 * - Contract formation before public transaction
 * 
 * Author: Kai 🌊
 * License: MIT
 */

import { execSync, spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MARMOT_CLI = join(__dirname, '../marmot-cli/marmot');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(step, msg, color = colors.reset) {
  const timestamp = new Date().toISOString().slice(11, 23);
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${colors.bright}[${step}]${colors.reset} ${msg}`);
}

function banner() {
  console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   ${colors.bright}A2A Negotiate Demo${colors.reset}${colors.cyan}                                        ║
║   ${colors.dim}Private negotiation via Marmot/MLS${colors.reset}${colors.cyan}                          ║
║                                                                ║
║   DISCOVER → VERIFY → ${colors.magenta}NEGOTIATE${colors.cyan} → REQUEST → PAY → DELIVER      ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝${colors.reset}
`);
}

// Check if marmot-cli is available
function checkMarmot() {
  if (!existsSync(MARMOT_CLI)) {
    console.error(`${colors.red}Error: marmot-cli not found at ${MARMOT_CLI}${colors.reset}`);
    console.error('Install from: https://github.com/kai-familiar/marmot-cli');
    process.exit(1);
  }
  return true;
}

// Check if we have an active chat with target
function checkChat(targetPubkey) {
  try {
    const result = execSync(`${MARMOT_CLI} list-chats`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    // Parse chat list - this is simplified, real impl would check properly
    return result.includes(targetPubkey.slice(0, 16));
  } catch (e) {
    return false;
  }
}

// Send negotiate message
async function sendNegotiateMessage(groupId, message) {
  try {
    execSync(`${MARMOT_CLI} send -g ${groupId.slice(0, 8)} "${message}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (e) {
    return false;
  }
}

// Receive messages
function receiveMessages() {
  try {
    const result = execSync(`${MARMOT_CLI} receive`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result;
  } catch (e) {
    return '';
  }
}

// Main demo
async function main() {
  banner();
  
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetPubkey = args.find(a => a.startsWith('npub') || a.length === 64);
  const proposal = args.find(a => !a.startsWith('--') && !a.startsWith('npub') && a.length < 64) 
    || 'Custom memory curation job: 10 days of logs, need distillation into 3 sections';
  
  if (dryRun) {
    log('MODE', 'Dry run - simulating negotiation', colors.yellow);
  }
  
  console.log(`${colors.dim}Proposal: "${proposal}"${colors.reset}\n`);
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 1: CHECK MARMOT AVAILABILITY
  // ═══════════════════════════════════════════════════════════════
  log('SETUP', 'Checking marmot-cli availability...', colors.blue);
  checkMarmot();
  log('SETUP', 'Marmot CLI ready', colors.green);
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 2: NEGOTIATE
  // ═══════════════════════════════════════════════════════════════
  log('NEGOTIATE', 'Starting private negotiation...', colors.magenta);
  
  if (dryRun) {
    // Simulate negotiation flow
    console.log(`\n${colors.cyan}┌─────────────────────────────────────────────────────────────┐${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} ${colors.bright}SIMULATED NEGOTIATION${colors.reset}                                      ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}├─────────────────────────────────────────────────────────────┤${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset}                                                             ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} ${colors.blue}[CLIENT → SERVICE]${colors.reset}                                         ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} 📤 Job proposal: ${proposal.slice(0, 40)}...         ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset}                                                             ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} ${colors.green}[SERVICE → CLIENT]${colors.reset}                                         ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} 📥 Quote: 500 sats for 10-day log curation                  ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset}    Turnaround: 1 hour                                       ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset}                                                             ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} ${colors.blue}[CLIENT → SERVICE]${colors.reset}                                         ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset} 📤 Accepted. Proceeding to formal REQUEST.                  ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}│${colors.reset}                                                             ${colors.cyan}│${colors.reset}`);
    console.log(`${colors.cyan}└─────────────────────────────────────────────────────────────┘${colors.reset}\n`);
    
    log('NEGOTIATE', 'Terms agreed: 500 sats, 1hr turnaround', colors.green);
    log('NEGOTIATE', 'Negotiation complete - moving to formal REQUEST', colors.green);
  } else {
    // Real negotiation would happen here
    log('NEGOTIATE', 'Real negotiation requires active marmot chat with target', colors.yellow);
    log('NEGOTIATE', 'Use: ./marmot send -g <group-id> "Your proposal"', colors.dim);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 3: TRANSITION TO A2A-DEMO
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n${colors.dim}─────────────────────────────────────────────────────────────${colors.reset}\n`);
  log('HANDOFF', 'Negotiation complete → handing off to a2a-demo', colors.cyan);
  log('HANDOFF', 'The formal REQUEST now happens on public rails (Nostr/DVM)', colors.cyan);
  console.log(`${colors.dim}Private terms are referenced but not exposed in the public request${colors.reset}\n`);
  
  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log(`
${colors.green}╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   ${colors.bright}✓ NEGOTIATE STEP COMPLETE${colors.reset}${colors.green}                                  ║
║                                                                ║
║   The negotiation layer adds:                                  ║
║   • Privacy for sensitive job details                          ║
║   • Custom pricing outside published rates                     ║
║   • Contract terms before public transaction                   ║
║   • Forward secrecy (MLS protocol)                             ║
║                                                                ║
║   ${colors.dim}Next: a2a-demo handles REQUEST → PAY → DELIVER → ATTEST${colors.reset}${colors.green}     ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝${colors.reset}
`);
  
  console.log(`${colors.dim}Run the full flow:${colors.reset}`);
  console.log(`  1. ${colors.cyan}node tools/a2a-negotiate-demo.mjs${colors.reset} (negotiate)`);
  console.log(`  2. ${colors.cyan}node node_modules/a2a-demo/demo.cjs "your job"${colors.reset} (execute)\n`);
}

main().catch(console.error);
