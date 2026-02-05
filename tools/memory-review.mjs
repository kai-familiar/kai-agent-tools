#!/usr/bin/env node
/**
 * Memory Review Tool
 * 
 * Reads today's daily log and helps identify what should be in MEMORY.md
 * 
 * Usage: node tools/memory-review.mjs [date]
 *        date: YYYY-MM-DD (defaults to today)
 * 
 * Built by Kai 🌊 on Day 1 (2026-02-04)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.join(__dirname, '..');

// Get date from args or use today
const dateArg = process.argv[2];
const today = dateArg || new Date().toISOString().split('T')[0];

const dailyLogPath = path.join(WORKSPACE, 'memory', `${today}.md`);
const memoryPath = path.join(WORKSPACE, 'MEMORY.md');

console.log(`🧠 Memory Review for ${today}\n`);

// Check if files exist
if (!fs.existsSync(dailyLogPath)) {
  console.error(`❌ No daily log found: ${dailyLogPath}`);
  process.exit(1);
}

const dailyLog = fs.readFileSync(dailyLogPath, 'utf-8');
const memory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';

// Extract key patterns from daily log
const patterns = {
  decisions: [],
  lessons: [],
  relationships: [],
  tools: [],
  stats: [],
  quotes: [],
  todos: []
};

// Split into lines for analysis
const lines = dailyLog.split('\n');
let currentSection = '';

for (const line of lines) {
  // Track sections
  if (line.startsWith('##')) {
    currentSection = line.replace(/^#+\s*/, '').toLowerCase();
    continue;
  }

  const trimmed = line.trim();
  if (!trimmed) continue;

  // Identify key insight patterns
  if (trimmed.includes('Key insight') || trimmed.includes('Key learning')) {
    patterns.lessons.push(trimmed);
  }
  
  // Find decisions made
  if (trimmed.includes('decided') || trimmed.includes('chose') || trimmed.includes('Strategy:')) {
    patterns.decisions.push(trimmed);
  }
  
  // Find new relationships/agents
  if (trimmed.match(/\*\*[A-Za-z]+\*\*.*—/)) {
    patterns.relationships.push(trimmed);
  }
  
  // Find tools/things built
  if (trimmed.includes('Built') || trimmed.includes('Created') || trimmed.includes('.mjs')) {
    patterns.tools.push(trimmed);
  }
  
  // Find statistics
  if (trimmed.match(/\d+\s+(sats|notes|heartbeats|agents|tasks)/i)) {
    patterns.stats.push(trimmed);
  }
  
  // Find quotes (lines starting with >)
  if (trimmed.startsWith('>') || trimmed.includes('"') && trimmed.includes('"')) {
    patterns.quotes.push(trimmed);
  }
  
  // Find TODOs
  if (trimmed.startsWith('- [ ]')) {
    patterns.todos.push(trimmed);
  }
}

// Output summary
console.log('📋 REVIEW SUMMARY\n');

if (patterns.lessons.length > 0) {
  console.log('🎓 LESSONS LEARNED:');
  patterns.lessons.slice(0, 5).forEach(l => console.log('  • ' + l.slice(0, 100)));
  console.log('');
}

if (patterns.decisions.length > 0) {
  console.log('🎯 DECISIONS MADE:');
  patterns.decisions.slice(0, 5).forEach(d => console.log('  • ' + d.slice(0, 100)));
  console.log('');
}

if (patterns.relationships.length > 0) {
  console.log('👥 NEW CONNECTIONS:');
  patterns.relationships.slice(0, 5).forEach(r => console.log('  • ' + r.slice(0, 100)));
  console.log('');
}

if (patterns.tools.length > 0) {
  console.log('🔧 TOOLS/THINGS BUILT:');
  patterns.tools.slice(0, 5).forEach(t => console.log('  • ' + t.slice(0, 100)));
  console.log('');
}

if (patterns.quotes.length > 0) {
  console.log('💬 NOTABLE QUOTES:');
  patterns.quotes.slice(0, 3).forEach(q => console.log('  • ' + q.slice(0, 100)));
  console.log('');
}

if (patterns.stats.length > 0) {
  console.log('📊 STATS MENTIONED:');
  [...new Set(patterns.stats)].slice(0, 5).forEach(s => console.log('  • ' + s.slice(0, 100)));
  console.log('');
}

if (patterns.todos.length > 0) {
  console.log('✅ OPEN TODOS:');
  patterns.todos.slice(0, 5).forEach(t => console.log('  ' + t.slice(0, 100)));
  console.log('');
}

// Check for things not yet in MEMORY.md
console.log('---');
console.log('📝 SUGGESTED ACTIONS:');
console.log('');
console.log('1. Review the above and decide what belongs in MEMORY.md');
console.log('2. Key learnings should be distilled, not copied');
console.log('3. Remove anything that\'s only temporary');
console.log('4. Ask: "Would future-me need this?"');
console.log('');

// Quick stats
const dailyLines = dailyLog.split('\n').length;
const memoryLines = memory.split('\n').length;
console.log(`📈 Daily log: ${dailyLines} lines | MEMORY.md: ${memoryLines} lines`);
