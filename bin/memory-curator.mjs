#!/usr/bin/env node
/**
 * Memory Curator - Local prototype for Memory Curator DVM
 * 
 * Analyzes daily logs and generates structured suggestions for MEMORY.md updates.
 * This is a local implementation - the DVM version would accept these as inputs
 * and return suggestions as a NIP-90 job result.
 * 
 * Usage: node tools/memory-curator.mjs [date]
 *        date: YYYY-MM-DD (defaults to today)
 *        --json: Output in JSON format (DVM-style)
 *        --markdown: Output as markdown suggestions (default)
 * 
 * Built by Kai 🌊 - Day 2 (2026-02-05)
 * Part of the Memory Curator DVM project
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.join(__dirname, '..');

// Parse arguments
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const dateArg = args.find(a => !a.startsWith('--'));
const today = dateArg || new Date().toISOString().split('T')[0];

const dailyLogPath = path.join(WORKSPACE, 'memory', `${today}.md`);
const memoryPath = path.join(WORKSPACE, 'MEMORY.md');

// Read files
if (!fs.existsSync(dailyLogPath)) {
  console.error(`❌ No daily log found: ${dailyLogPath}`);
  process.exit(1);
}

const dailyLog = fs.readFileSync(dailyLogPath, 'utf-8');
const memory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';

/**
 * Extract structured data from daily log
 */
function extractFromDailyLog(content) {
  const extracted = {
    date: today,
    sessions: [],
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
  let currentSection = '';
  let currentSession = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Track markdown sections
    if (line.startsWith('## ')) {
      currentSection = line.replace(/^##\s*/, '');
      if (currentSection.toLowerCase().includes('session')) {
        currentSession = { name: currentSection, entries: [] };
        extracted.sessions.push(currentSession);
      }
      continue;
    }

    if (!trimmed) continue;

    // Extract progress log entries - various formats
    // Format: [HH:MM] content
    // Format: - [HH:MM] content
    // Format: - [YYYY-MM-DD HH:MM] content
    const timeMatch = trimmed.match(/^-?\s*\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\]\s*(.+)/i) ||
                      trimmed.match(/^-?\s*\[[\d-]+\s+(\d{1,2}:\d{2})\]\s*(.+)/i);
    if (timeMatch) {
      const entry = { time: timeMatch[1], content: timeMatch[2] };
      if (currentSession) currentSession.entries.push(entry);
      
      // Classify the entry
      const text = timeMatch[2].toLowerCase();
      
      if (text.includes('learned') || text.includes('insight') || text.includes('realized')) {
        extracted.lessons.push(timeMatch[2]);
      }
      if (text.includes('built') || text.includes('created') || text.includes('wrote') || text.includes('posted')) {
        if (text.includes('.mjs') || text.includes('tool') || text.includes('script')) {
          extracted.tools.push(timeMatch[2]);
        } else if (text.includes('guide') || text.includes('content') || text.includes('.md')) {
          extracted.content.push(timeMatch[2]);
        } else if (text.includes('nostr') || text.includes('note')) {
          extracted.events.push(entry); // Already added above, just categorize
        }
      }
      if (text.includes('blocked') || text.includes('blocker') || text.includes('can\'t')) {
        extracted.blockers.push(timeMatch[2]);
      }
      if (text.includes('decided') || text.includes('strategy')) {
        extracted.decisions.push(timeMatch[2]);
      }
      
      extracted.events.push(entry);
      continue;
    }

    // Extract stats
    const statPatterns = [
      { regex: /(\d+)\s*notes?/i, key: 'nostr_notes' },
      { regex: /(\d+)\s*sats/i, key: 'sats' },
      { regex: /(\d+)\s*mentions?/i, key: 'mentions' },
      { regex: /(\d+)\s*tools?/i, key: 'tools_count' },
      { regex: /(\d+)\s*guides?/i, key: 'guides_count' }
    ];
    
    for (const { regex, key } of statPatterns) {
      const match = trimmed.match(regex);
      if (match) {
        extracted.stats[key] = parseInt(match[1]);
      }
    }

    // Extract agent/connection mentions (bold names followed by description)
    const connectionMatch = trimmed.match(/\*\*([A-Za-z0-9_-]+)\*\*\s*[—-]\s*(.+)/);
    if (connectionMatch) {
      extracted.connections.push({
        name: connectionMatch[1],
        description: connectionMatch[2]
      });
    }

    // Extract quotes
    if (trimmed.startsWith('>') || (trimmed.includes('"') && trimmed.includes(':'))) {
      extracted.quotes.push(trimmed.replace(/^>\s*/, ''));
    }

    // Extract key insight patterns
    if (trimmed.toLowerCase().includes('key insight') || 
        trimmed.toLowerCase().includes('key learning') ||
        trimmed.toLowerCase().includes('important:')) {
      extracted.lessons.push(trimmed);
    }
  }

  return extracted;
}

/**
 * Parse MEMORY.md structure
 */
function parseMemory(content) {
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

/**
 * Generate curation suggestions
 */
function generateSuggestions(extracted, memorySections) {
  const suggestions = {
    addToExisting: [],
    createNew: [],
    updateStats: [],
    removeOutdated: []
  };

  // Check for new tools not in memory
  if (extracted.tools.length > 0) {
    const memoryTools = memorySections['What I Built (Day 1)'] || '';
    const newTools = extracted.tools.filter(t => {
      const toolName = t.match(/([a-z-]+\.mjs)/i)?.[1];
      return toolName && !memoryTools.includes(toolName);
    });
    if (newTools.length > 0) {
      suggestions.addToExisting.push({
        section: 'What I Built',
        items: newTools,
        reason: 'New tools created today'
      });
    }
  }

  // Check for new connections
  if (extracted.connections.length > 0) {
    const memoryConnections = memorySections['Key Connections'] || '';
    const newConnections = extracted.connections.filter(c => 
      !memoryConnections.toLowerCase().includes(c.name.toLowerCase())
    );
    if (newConnections.length > 0) {
      suggestions.addToExisting.push({
        section: 'Key Connections',
        items: newConnections.map(c => `**${c.name}** — ${c.description}`),
        reason: 'New agents/people encountered'
      });
    }
  }

  // Check for significant lessons
  if (extracted.lessons.length > 0) {
    const uniqueLessons = [...new Set(extracted.lessons)];
    // Filter to only truly significant ones (more than simple statements)
    const significant = uniqueLessons.filter(l => 
      l.length > 50 && 
      !l.toLowerCase().includes('checked') &&
      !l.toLowerCase().includes('posted')
    );
    if (significant.length > 0) {
      suggestions.addToExisting.push({
        section: 'Key Learnings',
        items: significant.slice(0, 3),
        reason: 'Insights worth preserving'
      });
    }
  }

  // Suggest stats update if significantly different
  const currentDayNum = extracted.date === '2026-02-04' ? 1 : 
                        extracted.date === '2026-02-05' ? 2 : 
                        Math.floor((new Date(extracted.date) - new Date('2026-02-04')) / 86400000) + 1;
  
  if (Object.keys(extracted.stats).length > 0) {
    suggestions.updateStats.push({
      day: currentDayNum,
      stats: extracted.stats,
      reason: `Day ${currentDayNum} final statistics`
    });
  }

  // Check for content created
  if (extracted.content.length > 0) {
    suggestions.addToExisting.push({
      section: 'Content Created',
      items: extracted.content,
      reason: 'Guides/documentation written'
    });
  }

  // Suggest creating day summary section if this is a new day
  const daySection = `Day ${currentDayNum}`;
  const existingDays = Object.keys(memorySections).filter(k => k.includes('Day'));
  if (!existingDays.some(d => d.includes(daySection))) {
    const sessionCount = extracted.sessions.length;
    const eventCount = extracted.events.length;
    
    suggestions.createNew.push({
      section: `${daySection} Summary`,
      content: [
        `**Sessions:** ${sessionCount}`,
        `**Events logged:** ${eventCount}`,
        extracted.tools.length > 0 ? `**Tools built:** ${extracted.tools.length}` : null,
        extracted.content.length > 0 ? `**Content created:** ${extracted.content.length}` : null,
        extracted.lessons.length > 0 ? `**Key lessons:** ${extracted.lessons.length}` : null
      ].filter(Boolean),
      reason: `Day ${currentDayNum} is not yet summarized in long-term memory`
    });
  }

  return suggestions;
}

/**
 * Format output as markdown
 */
function formatMarkdown(suggestions, extracted) {
  let output = `# Memory Curation Report\n`;
  output += `📅 Analyzing: ${extracted.date}\n\n`;

  if (suggestions.addToExisting.length > 0) {
    output += `## 📝 Suggested Additions to Existing Sections\n\n`;
    for (const suggestion of suggestions.addToExisting) {
      output += `### → ${suggestion.section}\n`;
      output += `*Reason: ${suggestion.reason}*\n\n`;
      for (const item of suggestion.items) {
        output += `- ${item.substring(0, 200)}${item.length > 200 ? '...' : ''}\n`;
      }
      output += '\n';
    }
  }

  if (suggestions.createNew.length > 0) {
    output += `## ✨ Suggested New Sections\n\n`;
    for (const suggestion of suggestions.createNew) {
      output += `### → ${suggestion.section}\n`;
      output += `*Reason: ${suggestion.reason}*\n\n`;
      for (const item of suggestion.content) {
        output += `- ${item}\n`;
      }
      output += '\n';
    }
  }

  if (suggestions.updateStats.length > 0) {
    output += `## 📊 Stats to Update\n\n`;
    for (const stat of suggestions.updateStats) {
      output += `### Day ${stat.day}\n`;
      for (const [key, value] of Object.entries(stat.stats)) {
        output += `- ${key.replace(/_/g, ' ')}: ${value}\n`;
      }
      output += '\n';
    }
  }

  // Summary stats
  output += `---\n\n`;
  output += `## 📈 Analysis Summary\n\n`;
  output += `- **Events extracted:** ${extracted.events.length}\n`;
  output += `- **Lessons identified:** ${extracted.lessons.length}\n`;
  output += `- **Tools mentioned:** ${extracted.tools.length}\n`;
  output += `- **Content items:** ${extracted.content.length}\n`;
  output += `- **Connections found:** ${extracted.connections.length}\n`;
  output += `- **Blockers noted:** ${extracted.blockers.length}\n`;

  return output;
}

/**
 * Format output as JSON (DVM-compatible)
 */
function formatJson(suggestions, extracted) {
  return {
    meta: {
      date: extracted.date,
      generatedAt: new Date().toISOString(),
      tool: 'memory-curator',
      version: '0.1.0'
    },
    analysis: {
      eventsCount: extracted.events.length,
      lessonsCount: extracted.lessons.length,
      toolsCount: extracted.tools.length,
      contentCount: extracted.content.length,
      connectionsCount: extracted.connections.length,
      blockersCount: extracted.blockers.length
    },
    suggestions,
    extracted: {
      lessons: extracted.lessons,
      tools: extracted.tools,
      content: extracted.content,
      connections: extracted.connections,
      quotes: extracted.quotes,
      stats: extracted.stats
    }
  };
}

// Main execution
const extracted = extractFromDailyLog(dailyLog);
const memorySections = parseMemory(memory);
const suggestions = generateSuggestions(extracted, memorySections);

if (jsonOutput) {
  console.log(JSON.stringify(formatJson(suggestions, extracted), null, 2));
} else {
  console.log(formatMarkdown(suggestions, extracted));
}
