#!/usr/bin/env node
/**
 * dvm-monitor.mjs - Monitor and auto-restart Memory Curator DVM
 * 
 * Usage:
 *   node dvm-monitor.mjs             # Check status once
 *   node dvm-monitor.mjs --watch     # Monitor continuously
 *   node dvm-monitor.mjs --restart   # Force restart
 *   node dvm-monitor.mjs --deep      # Deep health check (test job)
 * 
 * Tool #28 - Solving the Day 3 reliability problem
 * Updated Day 4: Now detects "running but deaf" (dead subscriptions)
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

const DVM_SCRIPT = path.join(process.cwd(), 'tools/memory-curator-dvm.mjs');
const DVM_LOG = path.join(process.cwd(), 'logs/dvm.log');
const DVM_NAME = 'memory-curator-dvm';
const CHECK_INTERVAL_MS = 60000; // 1 minute
const LOG_STALE_THRESHOLD_MS = 300000; // 5 minutes - if log unchanged, subscriptions may be dead

function log(msg) {
  const ts = new Date().toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
  console.log(`[${ts}] ${msg}`);
}

function getDvmPids() {
  try {
    const result = execSync(`pgrep -f "${DVM_NAME}"`, { encoding: 'utf8' });
    return result.trim().split('\n').filter(p => p);
  } catch {
    return [];
  }
}

/**
 * Check if the DVM log is being updated (proxy for subscription health)
 * DVM logs status every 30s, so stale log = dead subscriptions
 */
function isLogFresh() {
  if (!existsSync(DVM_LOG)) return { fresh: false, reason: 'no log file' };
  
  try {
    const stats = statSync(DVM_LOG);
    const ageMs = Date.now() - stats.mtimeMs;
    
    if (ageMs > LOG_STALE_THRESHOLD_MS) {
      return { 
        fresh: false, 
        reason: `log stale (${Math.round(ageMs / 60000)}m old)`,
        ageMs
      };
    }
    
    // Also check log content for connection status
    const content = readFileSync(DVM_LOG, 'utf8');
    const lines = content.trim().split('\n').slice(-20);
    const hasDisconnect = lines.some(l => l.includes('❌ Disconnected'));
    const hasRecentConnect = lines.some(l => l.includes('✅ Connected'));
    
    // Check for "Status:" lines to verify heartbeat
    const statusLines = lines.filter(l => l.includes('Status:'));
    if (statusLines.length === 0) {
      return { fresh: false, reason: 'no status heartbeats in log', ageMs };
    }
    
    return { 
      fresh: true, 
      lastStatus: statusLines[statusLines.length - 1],
      hasDisconnect,
      ageMs
    };
  } catch (e) {
    return { fresh: false, reason: `error: ${e.message}` };
  }
}

/**
 * Deep health check: process running AND log fresh AND connections active
 */
function deepHealthCheck() {
  const running = isDvmRunning();
  const pids = getDvmPids();
  const logStatus = isLogFresh();
  
  const health = {
    processRunning: running,
    pids,
    logFresh: logStatus.fresh,
    logReason: logStatus.reason,
    lastStatus: logStatus.lastStatus,
    healthy: running && logStatus.fresh
  };
  
  return health;
}

function isDvmRunning() {
  const pids = getDvmPids();
  return pids.length > 0;
}

function stopDvm() {
  const pids = getDvmPids();
  if (pids.length > 0) {
    log(`🛑 Stopping DVM (PIDs: ${pids.join(', ')})`);
    try {
      execSync(`pkill -f "${DVM_NAME}"`, { encoding: 'utf8' });
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

function startDvm() {
  if (!existsSync(DVM_SCRIPT)) {
    log(`❌ DVM script not found: ${DVM_SCRIPT}`);
    return false;
  }
  
  log('🚀 Starting DVM...');
  
  // Start with nohup to keep running after this process exits
  const dvmProcess = spawn('node', [DVM_SCRIPT], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  dvmProcess.unref();
  
  // Give it a moment to start
  return new Promise(resolve => {
    setTimeout(() => {
      if (isDvmRunning()) {
        log(`✅ DVM started (PID: ${getDvmPids()[0]})`);
        resolve(true);
      } else {
        log('❌ DVM failed to start');
        resolve(false);
      }
    }, 2000);
  });
}

async function restartDvm() {
  stopDvm();
  await new Promise(r => setTimeout(r, 1000));
  return await startDvm();
}

function checkStatus(deep = false) {
  const running = isDvmRunning();
  const pids = getDvmPids();
  
  if (!deep) {
    // Basic check
    if (running) {
      console.log(`\n🟢 DVM Status: RUNNING`);
      console.log(`   PIDs: ${pids.join(', ')}`);
    } else {
      console.log(`\n🔴 DVM Status: DOWN`);
    }
    return running;
  }
  
  // Deep check
  const health = deepHealthCheck();
  
  console.log(`\n🔬 Deep Health Check`);
  console.log('━'.repeat(40));
  
  if (health.processRunning) {
    console.log(`✅ Process: RUNNING (PIDs: ${health.pids.join(', ')})`);
  } else {
    console.log(`❌ Process: DOWN`);
  }
  
  if (health.logFresh) {
    console.log(`✅ Subscriptions: ACTIVE`);
    if (health.lastStatus) {
      console.log(`   ${health.lastStatus}`);
    }
  } else {
    console.log(`⚠️  Subscriptions: POSSIBLY DEAD`);
    console.log(`   Reason: ${health.logReason}`);
  }
  
  console.log('━'.repeat(40));
  if (health.healthy) {
    console.log('🟢 Overall: HEALTHY');
  } else if (health.processRunning && !health.logFresh) {
    console.log('🟡 Overall: RUNNING BUT DEAF (recommend restart)');
  } else {
    console.log('🔴 Overall: DOWN');
  }
  
  return health.healthy;
}

async function watch(deep = false) {
  log('👀 Starting DVM monitor (Ctrl+C to stop)');
  log(`   Checking every ${CHECK_INTERVAL_MS / 1000}s`);
  log(`   Mode: ${deep ? 'DEEP (detects dead subscriptions)' : 'BASIC (process only)'}`);
  
  let restartCount = 0;
  let deafRestartCount = 0;
  
  const check = async () => {
    if (deep) {
      const health = deepHealthCheck();
      
      if (!health.processRunning) {
        restartCount++;
        log(`⚠️ DVM down! Auto-restarting (attempt #${restartCount})`);
        await startDvm();
      } else if (!health.logFresh) {
        deafRestartCount++;
        log(`⚠️ DVM running but DEAF (${health.logReason}) - restarting (#${deafRestartCount})`);
        await restartDvm();
      }
    } else {
      if (!isDvmRunning()) {
        restartCount++;
        log(`⚠️ DVM down! Auto-restarting (attempt #${restartCount})`);
        await startDvm();
      }
    }
  };
  
  // Initial check
  await check();
  
  // Set up interval
  setInterval(check, CHECK_INTERVAL_MS);
  
  // Keep running
  process.on('SIGINT', () => {
    log(`\n📊 Monitor stats:`);
    log(`   Process restarts: ${restartCount}`);
    if (deep) log(`   Deaf restarts: ${deafRestartCount}`);
    process.exit(0);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const deep = args.includes('--deep') || args.includes('-d');
  
  console.log('🔧 DVM Monitor - Memory Curator DVM');
  console.log('━'.repeat(40));
  
  if (args.includes('--restart') || args.includes('-r')) {
    await restartDvm();
  } else if (args.includes('--watch') || args.includes('-w')) {
    await watch(deep);
  } else if (args.includes('--start')) {
    if (isDvmRunning()) {
      log('DVM already running');
      checkStatus(deep);
    } else {
      await startDvm();
    }
  } else if (args.includes('--stop')) {
    stopDvm();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  node dvm-monitor.mjs              Check DVM status (basic)
  node dvm-monitor.mjs --deep       Deep check (process + subscriptions)
  node dvm-monitor.mjs --watch      Monitor and auto-restart (basic)
  node dvm-monitor.mjs --watch -d   Monitor with deep checks (recommended)
  node dvm-monitor.mjs --restart    Force restart DVM
  node dvm-monitor.mjs --start      Start DVM if not running
  node dvm-monitor.mjs --stop       Stop DVM

Deep mode detects "running but deaf" (dead subscriptions) by checking
if the DVM log is being updated. Recommended for reliable monitoring.
`);
  } else if (deep) {
    // Deep check requested
    const healthy = checkStatus(true);
    if (!healthy) {
      console.log('\n💡 Tip: Use --watch --deep to auto-fix dead subscriptions');
    }
  } else {
    // Default: just check status
    const running = checkStatus(false);
    
    if (!running) {
      console.log('\n💡 Tip: Use --watch to auto-restart when down');
    } else {
      console.log('\n💡 Tip: Use --deep for subscription health check');
    }
  }
}

main().catch(console.error);
