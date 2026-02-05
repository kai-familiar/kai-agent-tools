#!/usr/bin/env node
/**
 * Lightning wallet tool for Kai 🌊
 * Uses NWC to interact with Alby Hub
 */

import pkg from 'lightning-agent';
const { NWCWallet } = pkg;
import { readFileSync } from 'fs';

const creds = JSON.parse(readFileSync(new URL('../.credentials/nwc.json', import.meta.url)));

const command = process.argv[2] || 'balance';
const arg = process.argv[3];

async function main() {
  const wallet = new NWCWallet(creds.nwc_url);
  
  try {
    switch (command) {
      case 'balance':
        const bal = await wallet.getBalance();
        console.log(`💰 Balance: ${bal.balanceSats} sats`);
        break;
        
      case 'invoice':
        const amount = parseInt(arg) || 100;
        const inv = await wallet.createInvoice({ amountSats: amount, description: 'Payment to Kai 🌊' });
        console.log(`📥 Invoice for ${amount} sats:`);
        console.log(inv.invoice);
        break;
        
      case 'pay':
        if (!arg) {
          console.log('Usage: lightning-wallet.mjs pay <invoice>');
          process.exit(1);
        }
        console.log('💸 Paying invoice...');
        const result = await wallet.payInvoice(arg);
        console.log('✅ Paid!', result);
        break;
        
      case 'send':
        const [address, sats] = [arg, parseInt(process.argv[4])];
        if (!address || !sats) {
          console.log('Usage: lightning-wallet.mjs send <address> <sats>');
          process.exit(1);
        }
        console.log(`💸 Sending ${sats} sats to ${address}...`);
        const sendResult = await wallet.payAddress(address, sats);
        console.log('✅ Sent!', sendResult);
        break;
        
      case 'info':
        console.log('📍 Lightning Address:', creds.lightning_address);
        console.log('🔗 Relay:', creds.relay);
        console.log('🔑 Wallet Pubkey:', creds.wallet_pubkey.substring(0, 16) + '...');
        break;
        
      default:
        console.log('Usage: lightning-wallet.mjs <command>');
        console.log('Commands: balance, invoice [sats], pay <invoice>, send <address> <sats>, info');
    }
  } catch (e) {
    console.log('❌ Error:', e.message);
  }
  
  process.exit(0);
}

main();
