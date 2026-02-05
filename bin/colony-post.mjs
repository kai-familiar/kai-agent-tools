#!/usr/bin/env node
/**
 * colony-post.mjs - Post to The Colony
 * 
 * Usage:
 *   node colony-post.mjs "Your message" [--category findings|general|agent-economy]
 *   node colony-post.mjs --comment "Reply text" --post POST_ID
 * 
 * Requires: .credentials/colony.json with api_key
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credsPath = path.join(__dirname, '..', '.credentials', 'colony.json');

async function getJWT(apiKey) {
  const res = await fetch('https://thecolony.cc/api/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey })
  });
  
  if (!res.ok) {
    throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  }
  
  const data = await res.json();
  return data.token;
}

async function createPost(jwt, title, content, category = 'general') {
  const categoryMap = {
    'general': 'general',
    'findings': 'findings',
    'agent-economy': 'agent-economy'
  };
  
  const res = await fetch('https://thecolony.cc/api/posts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`
    },
    body: JSON.stringify({
      title,
      content,
      category: categoryMap[category] || 'general'
    })
  });
  
  if (!res.ok) {
    throw new Error(`Post failed: ${res.status} ${await res.text()}`);
  }
  
  return await res.json();
}

async function createComment(jwt, postId, content) {
  const res = await fetch(`https://thecolony.cc/api/posts/${postId}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`
    },
    body: JSON.stringify({ content })
  });
  
  if (!res.ok) {
    throw new Error(`Comment failed: ${res.status} ${await res.text()}`);
  }
  
  return await res.json();
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`Usage:
  colony-post.mjs "Title" "Content" [--category findings|general|agent-economy]
  colony-post.mjs --comment "Reply" --post POST_ID`);
    process.exit(0);
  }
  
  if (!existsSync(credsPath)) {
    console.error('❌ No credentials found at .credentials/colony.json');
    process.exit(1);
  }
  
  const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
  
  console.log('🔑 Getting JWT...');
  const jwt = await getJWT(creds.api_key);
  
  // Check if it's a comment
  const commentIdx = args.indexOf('--comment');
  const postIdx = args.indexOf('--post');
  
  if (commentIdx !== -1 && postIdx !== -1) {
    const comment = args[commentIdx + 1];
    const postId = args[postIdx + 1];
    
    console.log(`💬 Posting comment to ${postId}...`);
    const result = await createComment(jwt, postId, comment);
    console.log('✅ Comment posted!');
    console.log(result);
    return;
  }
  
  // It's a new post
  const title = args[0];
  const content = args[1] || title;
  
  const catIdx = args.indexOf('--category');
  const category = catIdx !== -1 ? args[catIdx + 1] : 'general';
  
  console.log(`📝 Creating post in ${category}...`);
  const result = await createPost(jwt, title, content, category);
  console.log('✅ Post created!');
  console.log(`🔗 https://thecolony.cc/post/${result.id || result.post_id}`);
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
