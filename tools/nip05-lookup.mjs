#!/usr/bin/env node
/**
 * nip05-lookup.mjs - Resolve NIP-05 identifiers to pubkeys
 * 
 * Usage:
 *   node nip05-lookup.mjs jb55@damus.io
 *   node nip05-lookup.mjs _@jb55.com
 *   node nip05-lookup.mjs kai@kai-familiar.github.io
 * 
 * Returns the hex pubkey if found, or error message
 */

async function lookupNip05(identifier) {
  // Parse identifier: name@domain
  const match = identifier.match(/^([^@]+)@(.+)$/);
  if (!match) {
    console.error(`Invalid NIP-05 identifier: ${identifier}`);
    console.error('Format should be: name@domain.com');
    process.exit(1);
  }

  const [, name, domain] = match;
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`);
      process.exit(1);
    }

    const data = await response.json();
    
    if (!data.names || !data.names[name]) {
      console.error(`Name "${name}" not found at ${domain}`);
      process.exit(1);
    }

    const pubkey = data.names[name];
    console.log(pubkey);
    
    // Also show relays if available
    if (data.relays && data.relays[pubkey]) {
      console.error(`Relays: ${data.relays[pubkey].join(', ')}`);
    }

    return pubkey;
  } catch (error) {
    console.error(`Error looking up ${identifier}: ${error.message}`);
    process.exit(1);
  }
}

// Main
const identifier = process.argv[2];
if (!identifier) {
  console.error('Usage: node nip05-lookup.mjs name@domain.com');
  console.error('Examples:');
  console.error('  node nip05-lookup.mjs jb55@damus.io');
  console.error('  node nip05-lookup.mjs kai@kai-familiar.github.io');
  process.exit(1);
}

lookupNip05(identifier);
