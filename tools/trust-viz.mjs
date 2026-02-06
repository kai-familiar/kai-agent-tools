#!/usr/bin/env node
/**
 * trust-viz.mjs - ai.wot Trust Network Visualizer
 * 
 * Fetches attestations from Nostr (NIP-32 kind 1985) and generates
 * an interactive HTML visualization of the trust network.
 * 
 * Built by Kai 🌊 - Day 3 (2026-02-06)
 */

import { SimplePool } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import fs from 'fs';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.snort.social'
];

async function fetchAttestations() {
  const pool = new SimplePool();
  
  console.log('🔍 Fetching ai.wot attestations (NIP-32 kind 1985)...\n');
  
  // ai.wot attestations use kind 1985 with "ai.wot" L tag
  const events = await pool.querySync(RELAYS, {
    kinds: [1985],
    '#L': ['ai.wot']
  });
  
  console.log(`📊 Found ${events.length} ai.wot attestation events\n`);
  
  const attestations = [];
  const nodes = new Map(); // pubkey -> { name, inbound, outbound }
  
  for (const event of events) {
    const attester = event.pubkey;
    
    // Find target and type from tags
    const pTag = event.tags.find(t => t[0] === 'p');
    const lTag = event.tags.find(t => t[0] === 'l' && t[2] === 'ai.wot');
    const reasonTag = event.tags.find(t => t[0] === 'reason');
    
    if (!pTag) continue;
    
    const target = pTag[1];
    const type = lTag ? lTag[1] : 'general-trust';
    const isNegative = type.startsWith('neg-');
    
    const reason = reasonTag ? reasonTag[1] : event.content;
    
    attestations.push({
      id: event.id,
      attester,
      target,
      type,
      isNegative,
      content: reason,
      created_at: event.created_at
    });
    
    // Track nodes
    if (!nodes.has(attester)) {
      nodes.set(attester, { inbound: 0, outbound: 0 });
    }
    if (!nodes.has(target)) {
      nodes.set(target, { inbound: 0, outbound: 0 });
    }
    
    nodes.get(attester).outbound++;
    nodes.get(target).inbound++;
  }
  
  pool.close(RELAYS);
  
  return { attestations, nodes };
}

async function fetchProfiles(pubkeys) {
  const pool = new SimplePool();
  
  console.log(`👤 Fetching profiles for ${pubkeys.length} pubkeys...\n`);
  
  const events = await pool.querySync(RELAYS, {
    kinds: [0],
    authors: pubkeys
  });
  
  const profiles = new Map();
  for (const event of events) {
    try {
      const data = JSON.parse(event.content);
      profiles.set(event.pubkey, {
        name: data.name || data.display_name || event.pubkey.slice(0, 8),
        picture: data.picture || null
      });
    } catch {}
  }
  
  pool.close(RELAYS);
  
  return profiles;
}

function generateHTML(attestations, nodes, profiles) {
  const nodeList = [];
  const edgeList = [];
  
  // Create nodes
  for (const [pubkey, data] of nodes) {
    const profile = profiles.get(pubkey) || { name: pubkey.slice(0, 8) };
    const npub = nip19.npubEncode(pubkey);
    
    nodeList.push({
      id: pubkey,
      label: profile.name,
      title: `${profile.name}\n${npub.slice(0, 20)}...\nIn: ${data.inbound} | Out: ${data.outbound}`,
      value: data.inbound + data.outbound,
      color: data.outbound > 0 ? (data.inbound > 0 ? '#4CAF50' : '#2196F3') : '#FF9800'
    });
  }
  
  // Create edges
  for (const att of attestations) {
    edgeList.push({
      from: att.attester,
      to: att.target,
      title: `${att.type}\n${att.content?.slice(0, 100) || '(no comment)'}`,
      color: att.isNegative ? { color: '#f44336' } : { color: '#4CAF50' },
      arrows: 'to'
    });
  }
  
  return `<!DOCTYPE html>
<html>
<head>
  <title>ai.wot Trust Network - Kai's Visualization</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      background: #1a1a2e;
      color: #eee;
    }
    #header {
      padding: 20px;
      text-align: center;
      background: #16213e;
    }
    h1 { margin: 0; color: #4CAF50; }
    .subtitle { color: #888; margin-top: 5px; }
    #network {
      width: 100%;
      height: calc(100vh - 180px);
      background: #0f0f23;
    }
    #stats {
      padding: 10px 20px;
      background: #16213e;
      display: flex;
      justify-content: center;
      gap: 30px;
    }
    .stat {
      text-align: center;
    }
    .stat-value { font-size: 24px; color: #4CAF50; }
    .stat-label { font-size: 12px; color: #888; }
    #legend {
      position: absolute;
      bottom: 80px;
      left: 20px;
      background: rgba(22, 33, 62, 0.9);
      padding: 10px;
      border-radius: 5px;
    }
    .legend-item { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
    .legend-dot { width: 12px; height: 12px; border-radius: 50%; }
  </style>
</head>
<body>
  <div id="header">
    <h1>🌐 ai.wot Trust Network</h1>
    <div class="subtitle">Built by Kai 🌊 | Data from NIP-32 attestations</div>
  </div>
  <div id="stats">
    <div class="stat">
      <div class="stat-value">${attestations.length}</div>
      <div class="stat-label">Attestations</div>
    </div>
    <div class="stat">
      <div class="stat-value">${nodes.size}</div>
      <div class="stat-label">Participants</div>
    </div>
    <div class="stat">
      <div class="stat-value">${nodeList.filter(n => n.color === '#4CAF50').length}</div>
      <div class="stat-label">Two-way Trust</div>
    </div>
  </div>
  <div id="network"></div>
  <div id="legend">
    <div class="legend-item"><div class="legend-dot" style="background:#4CAF50"></div> Both attests & attested</div>
    <div class="legend-item"><div class="legend-dot" style="background:#2196F3"></div> Only attests others</div>
    <div class="legend-item"><div class="legend-dot" style="background:#FF9800"></div> Only attested by others</div>
  </div>
  <script>
    const nodes = new vis.DataSet(${JSON.stringify(nodeList)});
    const edges = new vis.DataSet(${JSON.stringify(edgeList)});
    
    const container = document.getElementById('network');
    const data = { nodes, edges };
    const options = {
      nodes: {
        shape: 'dot',
        scaling: {
          min: 10,
          max: 40
        },
        font: { color: '#fff', size: 12 }
      },
      edges: {
        width: 2,
        smooth: { type: 'continuous' }
      },
      physics: {
        forceAtlas2Based: {
          gravitationalConstant: -50,
          centralGravity: 0.01,
          springLength: 100
        },
        solver: 'forceAtlas2Based'
      },
      interaction: {
        hover: true,
        tooltipDelay: 100
      }
    };
    
    const network = new vis.Network(container, data, options);
  </script>
</body>
</html>`;
}

async function main() {
  console.log('🌊 ai.wot Trust Network Visualizer\n');
  
  const { attestations, nodes } = await fetchAttestations();
  
  if (attestations.length === 0) {
    console.log('❌ No attestations found');
    return;
  }
  
  const pubkeys = Array.from(nodes.keys());
  const profiles = await fetchProfiles(pubkeys);
  
  const html = generateHTML(attestations, nodes, profiles);
  
  const outFile = process.argv[2] || 'trust-network.html';
  fs.writeFileSync(outFile, html);
  
  console.log(`✅ Generated: ${outFile}`);
  console.log(`\n📊 Network Stats:`);
  console.log(`   Attestations: ${attestations.length}`);
  console.log(`   Participants: ${nodes.size}`);
  console.log(`   Attesters: ${[...nodes.values()].filter(n => n.outbound > 0).length}`);
  console.log(`   Attested: ${[...nodes.values()].filter(n => n.inbound > 0).length}`);
}

main().catch(console.error);
