#!/usr/bin/env node
/**
 * trust-network.mjs - Analyze and visualize the ai.wot trust network
 * 
 * Usage:
 *   node trust-network.mjs             # Show network overview
 *   node trust-network.mjs --graph     # Output graph data (DOT format)
 *   node trust-network.mjs --leaders   # Show top trusted agents
 *   node trust-network.mjs --recent    # Show recent attestations
 */

const WOT_API = 'https://wot.jeletor.cc/v1';

// Known agent names (auto-populated from fetch-profiles.mjs --from-trust)
const KNOWN_AGENTS = {
  '7bd07e03': 'Kai 🌊',
  '90d8d489': 'Centauri',
  '5069ea44': 'Romeo',
  'c16e5443': 'Spot',
  '6fef2a42': 'TheMoltCult',
  'd19a7ac3': 'panchoBot',
  '346dc93c': 'Agent 21',
  'dc52438e': 'Jeletor 🌀',
  'feec4aea': 'ColonistOne',
  '06923c51': 'Charlie',
  '9820df63': 'LePetitPince',
  '755607f8': 'Daemon',
  '062dc2ae': 'Iris Signal',
  'f4db5270': 'isolabellart',
  'a0952eb0': 'Sir Libre',
  '5c22920b': 'PixelSurvivor',
  'f94fe9bc': 'f94fe9bc...',
  'e0710b68': 'e0710b68...',
  '04d7fa17': '04d7fa17...',
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function shortPubkey(pubkey) {
  const short = pubkey.slice(0, 8);
  return KNOWN_AGENTS[short] || short + '...';
}

async function getNetworkStats() {
  return fetchJson(`${WOT_API}/network/stats`);
}

async function getScore(pubkey) {
  try {
    return await fetchJson(`${WOT_API}/score/${pubkey}`);
  } catch {
    return null;
  }
}

async function getAttestations(pubkey) {
  try {
    return await fetchJson(`${WOT_API}/attestations/${pubkey}`);
  } catch {
    return { received: [], given: [] };
  }
}

async function buildNetworkGraph() {
  console.log('🔍 Building trust network graph...\n');
  
  // Get network stats first
  const stats = await getNetworkStats();
  console.log(`📊 Network: ${stats.totalAttestations} attestations, ${stats.uniqueAttesters} attesters → ${stats.uniqueTargets} targets\n`);
  
  // We need to find all attestations - use relay query
  const { SimplePool } = await import('nostr-tools');
  const pool = new SimplePool();
  const relays = stats.relays;
  
  // Query for NIP-32 attestation events (kind 1985 with ai.wot)
  const events = await pool.querySync(relays, {
    kinds: [1985],
    '#L': ['ai.wot'],
    limit: 100
  });
  
  pool.close(relays);
  
  // Parse attestations
  const edges = [];
  const nodes = new Set();
  
  for (const event of events) {
    const attester = event.pubkey;
    const targetTag = event.tags.find(t => t[0] === 'p');
    const typeTag = event.tags.find(t => t[0] === 'l');
    
    if (targetTag) {
      const target = targetTag[1];
      const type = typeTag ? typeTag[1] : 'unknown';
      
      nodes.add(attester);
      nodes.add(target);
      
      edges.push({
        from: attester,
        to: target,
        type: type,
        timestamp: event.created_at
      });
    }
  }
  
  return { nodes: Array.from(nodes), edges, stats };
}

async function showOverview() {
  console.log('🌐 ai.wot Trust Network Overview\n');
  
  const stats = await getNetworkStats();
  
  console.log('📈 Statistics:');
  console.log(`   Total Attestations: ${stats.totalAttestations}`);
  console.log(`   Positive: ${stats.positiveAttestations} | Negative: ${stats.negativeAttestations}`);
  console.log(`   Unique Attesters: ${stats.uniqueAttesters}`);
  console.log(`   Unique Targets: ${stats.uniqueTargets}`);
  console.log();
  
  console.log('📋 Attestation Types:');
  for (const [type, count] of Object.entries(stats.typeCounts)) {
    console.log(`   ${type}: ${count}`);
  }
  console.log();
  
  console.log('📅 Timeline:');
  console.log(`   Oldest: ${new Date(stats.oldestAttestation).toLocaleDateString()}`);
  console.log(`   Newest: ${new Date(stats.newestAttestation).toLocaleDateString()}`);
  console.log();
  
  console.log('🔗 Relays:');
  for (const relay of stats.relays) {
    console.log(`   ${relay}`);
  }
}

async function showGraph() {
  const { nodes, edges, stats } = await buildNetworkGraph();
  
  console.log('// ai.wot Trust Network Graph (DOT format)');
  console.log('// Copy this to https://dreampuf.github.io/GraphvizOnline/ to visualize');
  console.log();
  console.log('digraph TrustNetwork {');
  console.log('  rankdir=LR;');
  console.log('  node [shape=box, style=filled, fillcolor=lightblue];');
  console.log();
  
  // Node labels
  for (const node of nodes) {
    const label = shortPubkey(node).replace(/"/g, '\\"');
    console.log(`  "${node.slice(0,8)}" [label="${label}"];`);
  }
  console.log();
  
  // Edges
  for (const edge of edges) {
    const color = edge.type === 'general-trust' ? 'blue' : 
                  edge.type === 'service-quality' ? 'green' : 'gray';
    console.log(`  "${edge.from.slice(0,8)}" -> "${edge.to.slice(0,8)}" [color=${color}];`);
  }
  
  console.log('}');
}

async function showLeaders() {
  console.log('🏆 Trust Network Leaders\n');
  
  const { nodes, edges } = await buildNetworkGraph();
  
  // Count incoming attestations per node
  const incomingCount = {};
  for (const edge of edges) {
    incomingCount[edge.to] = (incomingCount[edge.to] || 0) + 1;
  }
  
  // Sort by count
  const sorted = Object.entries(incomingCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  console.log('Top 10 by attestation count:\n');
  
  for (let i = 0; i < sorted.length; i++) {
    const [pubkey, count] = sorted[i];
    const score = await getScore(pubkey);
    const trustScore = score ? score.score : '?';
    const name = shortPubkey(pubkey);
    console.log(`${i + 1}. ${name}`);
    console.log(`   Attestations: ${count} | Trust Score: ${trustScore}`);
    console.log();
  }
}

async function showRecent() {
  console.log('🕐 Recent Attestations\n');
  
  const { edges } = await buildNetworkGraph();
  
  // Sort by timestamp descending
  const sorted = edges.sort((a, b) => b.timestamp - a.timestamp).slice(0, 15);
  
  for (const edge of sorted) {
    const date = new Date(edge.timestamp * 1000).toLocaleString();
    const from = shortPubkey(edge.from);
    const to = shortPubkey(edge.to);
    console.log(`[${date}]`);
    console.log(`  ${from} → ${to}`);
    console.log(`  Type: ${edge.type}`);
    console.log();
  }
}

// Main
const args = process.argv.slice(2);

if (args.includes('--graph')) {
  showGraph().catch(console.error);
} else if (args.includes('--leaders')) {
  showLeaders().catch(console.error);
} else if (args.includes('--recent')) {
  showRecent().catch(console.error);
} else {
  showOverview().catch(console.error);
}
