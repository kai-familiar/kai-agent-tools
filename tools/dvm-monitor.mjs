#!/usr/bin/env node
/**
 * dvm-monitor.mjs - Monitor and auto-restart Memory Curator DVM
 * 
 * Usage:
 *   node dvm-monitor.mjs             # Check status once
 *   node dvm-monitor.mjs --watch     # Monitor continuously
 *   node dvm-monitor.mjs --restart   # Force restart
 * 
 * Tool #28 - Solving the Day 3 reliability problem
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const DVM_SCRIPT = path.join(process.cwd(), 'tools/memory-curator-dvm.mjs');
const DVM_NAME = 'memory-curator-dvm';
const CHECK_INTERVAL_MS = 60000; // 1 minute

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

function checkStatus() {
  const running = isDvmRunning();
  const pids = getDvmPids();
  
  if (running) {
    console.log(`\n🟢 DVM Status: RUNNING`);
    console.log(`   PIDs: ${pids.join(', ')}`);
  } else {
    console.log(`\n🔴 DVM Status: DOWN`);
  }
  
  return running;
}

async function watch() {
  log('👀 Starting DVM monitor (Ctrl+C to stop)');
  log(`   Checking every ${CHECK_INTERVAL_MS / 1000}s`);
  
  let restartCount = 0;
  
  const check = async () => {
    if (!isDvmRunning()) {
      restartCount++;
      log(`⚠️ DVM down! Auto-restarting (attempt #${restartCount})`);
      await startDvm();
    } else {
      // Only log occasionally to avoid spam
      if (restartCount > 0) {
        log(`✅ DVM running (${restartCount} restarts since monitoring started)`);
      }
    }
  };
  
  // Initial check
  await check();
  
  // Set up interval
  setInterval(check, CHECK_INTERVAL_MS);
  
  // Keep running
  process.on('SIGINT', () => {
    log(`\n📊 Monitor stats: ${restartCount} restarts during session`);
    process.exit(0);
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  console.log('🔧 DVM Monitor - Memory Curator DVM');
  console.log('━'.repeat(40));
  
  if (args.includes('--restart') || args.includes('-r')) {
    await restartDvm();
  } else if (args.includes('--watch') || args.includes('-w')) {
    await watch();
  } else if (args.includes('--start')) {
    if (isDvmRunning()) {
      log('DVM already running');
      checkStatus();
    } else {
      await startDvm();
    }
  } else if (args.includes('--stop')) {
    stopDvm();
  } else if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  node dvm-monitor.mjs           Check DVM status
  node dvm-monitor.mjs --watch   Monitor and auto-restart
  node dvm-monitor.mjs --restart Force restart DVM
  node dvm-monitor.mjs --start   Start DVM if not running
  node dvm-monitor.mjs --stop    Stop DVM
`);
  } else {
    // Default: just check status
    const running = checkStatus();
    
    if (!running) {
      console.log('\n💡 Tip: Use --watch to auto-restart when down');
    }
  }
}

main().catch(console.error);
