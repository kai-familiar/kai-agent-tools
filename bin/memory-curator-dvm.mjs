#!/usr/bin/env node
/**
 * Memory Curator DVM - NIP-90 Data Vending Machine
 * 
 * Listens for kind 5700 job requests and returns kind 6700 results.
 * Uses the same curation logic as memory-curator.mjs but as a service.
 * 
 * Usage: 
 *   node tools/memory-curator-dvm.mjs                 # Start DVM service
 *   node tools/memory-curator-dvm.mjs --test         # Test with sample job
 *   node tools/memory-curator-dvm.mjs --status       # Show service status
 * 
 * Environment:
 *   NOSTR_KEYS_PATH: Path to nostr.json (default: .credentials/nostr.json)
 *   DVM_RELAYS: Comma-separated relay URLs
 * 
 * NIP-90 Kind: 5700 (request) / 6700 (result)
 * 
 * Built by Kai 🌊 - Day 2 (2026-02-05)
 */

import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';

// Convert hex string to Uint8Array
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.join(__dirname, '..');

// DVM Configuration
const DVM_KIND_REQUEST = 5700;  // Memory Curation request
const DVM_KIND_RESULT = 6700;   // Memory Curation result (5700 + 1000)
const DVM_KIND_STATUS = 7000;   // Job status update

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol'
];

// Load Nostr keys
function loadKeys() {
  const keysPath = process.env.NOSTR_KEYS_PATH || 
                   path.join(WORKSPACE, '.credentials', 'nostr.json');
  
  if (!fs.existsSync(keysPath)) {
    console.error('❌ No Nostr keys found at:', keysPath);
    process.exit(1);
  }
  
  const keys = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
  return {
    secretKey: hexToBytes(keys.privateKeyHex),
    publicKey: keys.publicKeyHex
  };
}

// Parse job request inputs
function parseJobRequest(event) {
  const inputs = {
    daily: null,
    memory: null,
    params: {
      style: 'concise',
      sections: null,
      maxItems: 5
    }
  };
  
  // First check for inputs in content field (for large data)
  if (event.content) {
    try {
      const contentData = JSON.parse(event.content);
      if (contentData.daily_log) inputs.daily = contentData.daily_log;
      if (contentData.memory_file) inputs.memory = contentData.memory_file;
    } catch (e) {
      // Content is not JSON, might be used for something else
    }
  }
  
  for (const tag of event.tags) {
    // Input tags: ["i", content, type, relay?, marker]
    if (tag[0] === 'i' && tag[2] === 'text') {
      const marker = tag[4] || tag[3]; // marker can be in position 3 or 4
      if (marker === 'daily' || marker === 'daily_log') {
        inputs.daily = tag[1];
      } else if (marker === 'memory' || marker === 'memory_file') {
        inputs.memory = tag[1];
      } else if (!inputs.daily) {
        // First text input without marker = daily log
        inputs.daily = tag[1];
      }
    }
    
    // Param tags: ["param", name, value]
    if (tag[0] === 'param') {
      if (tag[1] === 'style') inputs.params.style = tag[2];
      if (tag[1] === 'sections') inputs.params.sections = tag[2];
      if (tag[1] === 'max_items') inputs.params.maxItems = parseInt(tag[2]);
    }
  }
  
  return inputs;
}

// Extract structured data from daily log
function extractFromDailyLog(content) {
  const extracted = {
    events: [],
    lessons: [],
    decisions: [],
    connections: [],
    tools: [],
    content: [],
    blockers: [],
    stats: {},
    quotes: []
  };

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Progress log entries
    const timeMatch = trimmed.match(/^-?\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)/i) ||
                      trimmed.match(/^-?\s*\[[\d-]+\s+(\d{1,2}:\d{2})\]\s*(.+)/i);
    if (timeMatch) {
      const entry = { time: timeMatch[1], content: timeMatch[2] };
      const text = timeMatch[2].toLowerCase();
      
      if (text.includes('learned') || text.includes('insight') || text.includes('realized')) {
        extracted.lessons.push(timeMatch[2]);
      }
      if (text.includes('built') || text.includes('created') || text.includes('wrote')) {
        if (text.includes('.mjs') || text.includes('tool') || text.includes('script')) {
          extracted.tools.push(timeMatch[2]);
        } else if (text.includes('guide') || text.includes('content') || text.includes('.md')) {
          extracted.content.push(timeMatch[2]);
        }
      }
      if (text.includes('blocked') || text.includes('can\'t')) {
        extracted.blockers.push(timeMatch[2]);
      }
      if (text.includes('decided') || text.includes('strategy')) {
        extracted.decisions.push(timeMatch[2]);
      }
      
      extracted.events.push(entry);
      continue;
    }

    // Stats
    const statPatterns = [
      { regex: /(\d+)\s*notes?/i, key: 'nostr_notes' },
      { regex: /(\d+)\s*sats/i, key: 'sats' },
      { regex: /(\d+)\s*tools?/i, key: 'tools_count' }
    ];
    
    for (const { regex, key } of statPatterns) {
      const match = trimmed.match(regex);
      if (match) extracted.stats[key] = parseInt(match[1]);
    }

    // Connections
    const connectionMatch = trimmed.match(/\*\*([A-Za-z0-9_-]+)\*\*\s*[—-]\s*(.+)/);
    if (connectionMatch) {
      extracted.connections.push({
        name: connectionMatch[1],
        description: connectionMatch[2]
      });
    }

    // Key insights
    if (trimmed.toLowerCase().includes('key insight') || 
        trimmed.toLowerCase().includes('key learning')) {
      extracted.lessons.push(trimmed);
    }
  }

  return extracted;
}

// Parse memory file sections
function parseMemory(content) {
  if (!content) return {};
  
  const sections = {};
  let currentSection = null;
  let currentContent = [];

  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentSection) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = line.replace(/^##\s*/, '');
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection] = currentContent.join('\n').trim();
  }

  return sections;
}

// Generate curation suggestions
function generateSuggestions(extracted, memorySections, params) {
  const suggestions = {
    addToExisting: [],
    createNew: [],
    updateStats: []
  };

  // Check for new tools
  if (extracted.tools.length > 0) {
    const memoryTools = Object.values(memorySections).join(' ');
    const newTools = extracted.tools.filter(t => {
      const toolName = t.match(/([a-z-]+\.mjs)/i)?.[1];
      return toolName && !memoryTools.includes(toolName);
    });
    if (newTools.length > 0) {
      suggestions.addToExisting.push({
        section: 'What I Built',
        items: newTools.slice(0, params.maxItems),
        reason: 'New tools created'
      });
    }
  }

  // Check for new connections
  if (extracted.connections.length > 0) {
    const memoryText = Object.values(memorySections).join(' ').toLowerCase();
    const newConnections = extracted.connections.filter(c => 
      !memoryText.includes(c.name.toLowerCase())
    );
    if (newConnections.length > 0) {
      suggestions.addToExisting.push({
        section: 'Key Connections',
        items: newConnections.slice(0, params.maxItems).map(c => 
          `**${c.name}** — ${c.description}`
        ),
        reason: 'New agents/people encountered'
      });
    }
  }

  // Check for significant lessons
  if (extracted.lessons.length > 0) {
    const uniqueLessons = [...new Set(extracted.lessons)].filter(l => l.length > 50);
    if (uniqueLessons.length > 0) {
      suggestions.addToExisting.push({
        section: 'Key Learnings',
        items: uniqueLessons.slice(0, params.maxItems),
        reason: 'Insights worth preserving'
      });
    }
  }

  // Stats update
  if (Object.keys(extracted.stats).length > 0) {
    suggestions.updateStats.push({
      stats: extracted.stats,
      reason: 'Daily statistics'
    });
  }

  return suggestions;
}

// Format result as markdown
function formatResult(suggestions, extracted, params) {
  const isDetailed = params.style === 'detailed';
  let output = '';

  if (suggestions.addToExisting.length > 0) {
    output += `## Suggested Additions\n\n`;
    for (const s of suggestions.addToExisting) {
      output += `### → ${s.section}\n`;
      if (isDetailed) output += `*Reason: ${s.reason}*\n\n`;
      for (const item of s.items) {
        const truncated = item.length > 150 ? item.substring(0, 150) + '...' : item;
        output += `- ${truncated}\n`;
      }
      output += '\n';
    }
  }

  if (suggestions.updateStats.length > 0) {
    output += `## Stats\n`;
    for (const s of suggestions.updateStats) {
      for (const [key, value] of Object.entries(s.stats)) {
        output += `- ${key.replace(/_/g, ' ')}: ${value}\n`;
      }
    }
    output += '\n';
  }

  output += `## Summary\n`;
  output += `- Events: ${extracted.events.length}\n`;
  output += `- Lessons: ${extracted.lessons.length}\n`;
  output += `- Tools: ${extracted.tools.length}\n`;
  output += `- Connections: ${extracted.connections.length}\n`;

  return output.trim();
}

// Process a job request
function processJob(event) {
  const inputs = parseJobRequest(event);
  
  if (!inputs.daily) {
    return { error: 'No daily log input provided', code: 'missing_input' };
  }
  
  const extracted = extractFromDailyLog(inputs.daily);
  const memorySections = parseMemory(inputs.memory || '');
  const suggestions = generateSuggestions(extracted, memorySections, inputs.params);
  const result = formatResult(suggestions, extracted, inputs.params);
  
  return { result, extracted, suggestions };
}

// Create job result event
function createResultEvent(keys, jobRequest, result) {
  const event = {
    kind: DVM_KIND_RESULT,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['request', JSON.stringify(jobRequest)],
      ['e', jobRequest.id],
      ['p', jobRequest.pubkey]
    ],
    content: result
  };
  
  return finalizeEvent(event, keys.secretKey);
}

// Create status event
function createStatusEvent(keys, jobRequest, status, message) {
  const event = {
    kind: DVM_KIND_STATUS,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['status', status, message || ''],
      ['e', jobRequest.id],
      ['p', jobRequest.pubkey]
    ],
    content: ''
  };
  
  return finalizeEvent(event, keys.secretKey);
}

// DVM Service
class MemoryCuratorDVM {
  constructor(keys, relays) {
    this.keys = keys;
    this.relays = relays;
    this.connections = new Map();
    this.processedJobs = new Set();
    this.stats = {
      started: new Date(),
      jobsReceived: 0,
      jobsProcessed: 0,
      errors: 0
    };
  }
  
  connect() {
    console.log('🌊 Memory Curator DVM starting...');
    console.log(`📍 Public key: ${this.keys.publicKey}`);
    console.log(`📡 Relays: ${this.relays.join(', ')}\n`);
    
    for (const relay of this.relays) {
      this.connectToRelay(relay);
    }
  }
  
  connectToRelay(url) {
    const ws = new WebSocket(url);
    
    ws.on('open', () => {
      console.log(`✅ Connected: ${url}`);
      this.connections.set(url, ws);
      
      // Subscribe to kind 5700 job requests
      const sub = JSON.stringify([
        'REQ',
        `dvm-${Date.now()}`,
        { kinds: [DVM_KIND_REQUEST], limit: 10 }
      ]);
      ws.send(sub);
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT') {
          this.handleEvent(msg[2], url);
        }
      } catch (e) {
        // Ignore parse errors
      }
    });
    
    ws.on('close', () => {
      console.log(`❌ Disconnected: ${url}`);
      this.connections.delete(url);
      // Reconnect after 5 seconds
      setTimeout(() => this.connectToRelay(url), 5000);
    });
    
    ws.on('error', (err) => {
      console.error(`⚠️ ${url}: ${err.message}`);
    });
  }
  
  handleEvent(event, relay) {
    // Skip if already processed
    if (this.processedJobs.has(event.id)) return;
    
    // Verify event
    if (!verifyEvent(event)) {
      console.log(`⚠️ Invalid event signature: ${event.id.slice(0, 8)}`);
      return;
    }
    
    // Check if it's for us (no specific targeting or targeting us)
    const pTag = event.tags.find(t => t[0] === 'p');
    if (pTag && pTag[1] !== this.keys.publicKey) {
      return; // Targeted at different DVM
    }
    
    this.processedJobs.add(event.id);
    this.stats.jobsReceived++;
    
    console.log(`\n📥 Job received: ${event.id.slice(0, 8)}...`);
    console.log(`   From: ${event.pubkey.slice(0, 8)}...`);
    
    // Send processing status
    const processingStatus = createStatusEvent(
      this.keys, event, 'processing', 'Analyzing daily log...'
    );
    this.broadcast(processingStatus);
    
    // Process the job
    const { result, error } = processJob(event);
    
    if (error) {
      console.log(`   ❌ Error: ${error}`);
      this.stats.errors++;
      const errorStatus = createStatusEvent(
        this.keys, event, 'error', error
      );
      this.broadcast(errorStatus);
      return;
    }
    
    // Send result
    const resultEvent = createResultEvent(this.keys, event, result);
    this.broadcast(resultEvent);
    
    this.stats.jobsProcessed++;
    console.log(`   ✅ Result sent: ${resultEvent.id.slice(0, 8)}...`);
  }
  
  broadcast(event) {
    const msg = JSON.stringify(['EVENT', event]);
    for (const [url, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }
  
  status() {
    const uptime = Math.floor((Date.now() - this.stats.started.getTime()) / 1000);
    return {
      ...this.stats,
      uptime: `${Math.floor(uptime / 60)}m ${uptime % 60}s`,
      connectedRelays: this.connections.size,
      processedCount: this.processedJobs.size
    };
  }
}

// Test mode
async function runTest() {
  console.log('🧪 Testing Memory Curator DVM\n');
  
  const testJob = {
    id: 'test-' + Date.now(),
    pubkey: 'test-pubkey',
    kind: DVM_KIND_REQUEST,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['i', `# 2026-02-05 Test Log

## Session 1 (10:00)
- [10:00] Built test-tool.mjs — a sample tool
- [10:05] Key insight: Testing is important
- [10:10] Realized that DVMs need good error handling

## Stats
- Nostr notes: 25
- Sats: 10000
`, 'text', '', 'daily'],
      ['i', `# MEMORY.md

## What I Built
- other-tool.mjs — something else
`, 'text', '', 'memory'],
      ['param', 'style', 'detailed']
    ],
    content: '',
    sig: ''
  };
  
  const { result, error, extracted } = processJob(testJob);
  
  if (error) {
    console.log('❌ Test failed:', error);
    return;
  }
  
  console.log('📊 Extracted:');
  console.log(`   Events: ${extracted.events.length}`);
  console.log(`   Lessons: ${extracted.lessons.length}`);
  console.log(`   Tools: ${extracted.tools.length}`);
  console.log('');
  console.log('📝 Result:\n');
  console.log(result);
  console.log('\n✅ Test passed!');
}

// Main
const args = process.argv.slice(2);

if (args.includes('--test')) {
  runTest();
} else if (args.includes('--status')) {
  console.log('ℹ️ Status check requires running DVM instance');
} else {
  // Start DVM service
  const keys = loadKeys();
  const relays = process.env.DVM_RELAYS?.split(',') || DEFAULT_RELAYS;
  
  const dvm = new MemoryCuratorDVM(keys, relays);
  dvm.connect();
  
  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n📊 Final stats:', dvm.status());
    process.exit(0);
  });
  
  // Periodic status
  setInterval(() => {
    const status = dvm.status();
    console.log(`\n📊 Status: ${status.jobsReceived} received, ${status.jobsProcessed} processed, ${status.connectedRelays} relays`);
  }, 60000);
}
