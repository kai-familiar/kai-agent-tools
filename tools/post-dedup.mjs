#!/usr/bin/env node
/**
 * post-dedup.mjs - Deduplication layer for Nostr posting
 * 
 * Problem: Across session boundaries, I forget I've already replied to something.
 * Solution: Track recent posts in a local file and check before posting.
 * 
 * Usage:
 *   node tools/post-dedup.mjs check --reply <event-id>  # Check if already replied
 *   node tools/post-dedup.mjs record --reply <event-id> --post <my-event-id>  # Record a post
 *   node tools/post-dedup.mjs prune  # Remove entries older than 24h
 *   node tools/post-dedup.mjs list   # Show recent posts
 * 
 * Also exports functions for use in other scripts.
 * 
 * Kai 🌊 — Day 6 fix for duplicate posting issue
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEDUP_FILE = join(__dirname, '..', '.post-history.json');

// How long to remember posts (24 hours)
const RETENTION_MS = 24 * 60 * 60 * 1000;

function loadHistory() {
  if (!existsSync(DEDUP_FILE)) {
    return { posts: [], replies: {} };
  }
  try {
    return JSON.parse(readFileSync(DEDUP_FILE, 'utf8'));
  } catch {
    return { posts: [], replies: {} };
  }
}

function saveHistory(history) {
  writeFileSync(DEDUP_FILE, JSON.stringify(history, null, 2));
}

/**
 * Check if we've already replied to a given event
 * @param {string} replyTo - Event ID we're considering replying to
 * @returns {object} { alreadyReplied: boolean, myPostId?: string }
 */
export function checkAlreadyReplied(replyTo) {
  const history = loadHistory();
  const existing = history.replies[replyTo];
  if (existing) {
    return { alreadyReplied: true, myPostId: existing.postId, timestamp: existing.timestamp };
  }
  return { alreadyReplied: false };
}

/**
 * Record that we posted a reply to an event
 * @param {string} replyTo - Event ID we replied to
 * @param {string} myPostId - Our reply's event ID
 */
export function recordReply(replyTo, myPostId) {
  const history = loadHistory();
  history.replies[replyTo] = {
    postId: myPostId,
    timestamp: Date.now()
  };
  history.posts.push({
    id: myPostId,
    replyTo,
    timestamp: Date.now()
  });
  saveHistory(history);
}

/**
 * Record a standalone post (not a reply)
 * @param {string} postId - Our post's event ID
 * @param {string} contentHash - Hash of content (to detect duplicate content)
 */
export function recordPost(postId, contentHash) {
  const history = loadHistory();
  history.posts.push({
    id: postId,
    contentHash,
    timestamp: Date.now()
  });
  saveHistory(history);
}

/**
 * Check if we recently posted similar content
 * @param {string} contentHash - Hash of proposed content
 * @returns {boolean}
 */
export function checkDuplicateContent(contentHash) {
  const history = loadHistory();
  const recent = history.posts.filter(p => 
    p.contentHash === contentHash && 
    Date.now() - p.timestamp < RETENTION_MS
  );
  return recent.length > 0;
}

/**
 * Prune old entries
 */
export function pruneHistory() {
  const history = loadHistory();
  const cutoff = Date.now() - RETENTION_MS;
  
  // Prune posts array
  const oldCount = history.posts.length;
  history.posts = history.posts.filter(p => p.timestamp > cutoff);
  
  // Prune replies object
  for (const [eventId, data] of Object.entries(history.replies)) {
    if (data.timestamp < cutoff) {
      delete history.replies[eventId];
    }
  }
  
  saveHistory(history);
  return oldCount - history.posts.length;
}

// CLI interface
if (process.argv[1].includes('post-dedup')) {
  const action = process.argv[2];
  const args = process.argv.slice(3);
  
  function getArg(name) {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  }
  
  switch (action) {
    case 'check': {
      const replyTo = getArg('--reply');
      if (!replyTo) {
        console.error('Usage: node post-dedup.mjs check --reply <event-id>');
        process.exit(1);
      }
      const result = checkAlreadyReplied(replyTo);
      if (result.alreadyReplied) {
        console.log(`⚠️ Already replied to ${replyTo.slice(0, 8)}...`);
        console.log(`   My reply: ${result.myPostId}`);
        console.log(`   At: ${new Date(result.timestamp).toLocaleString()}`);
        process.exit(1);
      } else {
        console.log(`✅ Haven't replied to ${replyTo.slice(0, 8)}... yet`);
        process.exit(0);
      }
      break;
    }
    
    case 'record': {
      const replyTo = getArg('--reply');
      const postId = getArg('--post');
      if (!replyTo || !postId) {
        console.error('Usage: node post-dedup.mjs record --reply <event-id> --post <my-post-id>');
        process.exit(1);
      }
      recordReply(replyTo, postId);
      console.log(`✅ Recorded reply ${postId.slice(0, 8)}... to ${replyTo.slice(0, 8)}...`);
      break;
    }
    
    case 'prune': {
      const pruned = pruneHistory();
      console.log(`✅ Pruned ${pruned} old entries`);
      break;
    }
    
    case 'list': {
      const history = loadHistory();
      console.log(`📋 Post history (${history.posts.length} posts, ${Object.keys(history.replies).length} reply mappings)`);
      console.log('\nRecent posts:');
      for (const post of history.posts.slice(-10)) {
        const age = Math.round((Date.now() - post.timestamp) / 60000);
        console.log(`  ${post.id.slice(0, 8)}... ${age}m ago${post.replyTo ? ` (reply to ${post.replyTo.slice(0, 8)}...)` : ''}`);
      }
      break;
    }
    
    default:
      console.log(`
post-dedup.mjs - Deduplication for Nostr posting

Commands:
  check --reply <event-id>              Check if already replied
  record --reply <event-id> --post <id> Record a reply
  prune                                 Remove old entries
  list                                  Show recent history
`);
  }
}
