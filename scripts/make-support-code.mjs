#!/usr/bin/env node
/**
 * Generate a support code to email back to a player.
 *
 * The player's support ID is in Settings -> Help & support (and pre-filled in
 * their support email). Codes are bound to that ID and expire (default 14 days).
 *
 *   node scripts/make-support-code.mjs <supportId> reset
 *   node scripts/make-support-code.mjs <supportId> level 87        # unlock level 87
 *   node scripts/make-support-code.mjs <supportId> coins 500
 *   node scripts/make-support-code.mjs <supportId> lives           # refill hearts
 *   node scripts/make-support-code.mjs <supportId> infinite 24    # unlimited hearts, hours
 *   ... [--days 30]                                                # custom expiry
 *
 * KEEP IN SYNC with src/services/Support.ts (same layout, same secret).
 */

import { createHmac } from 'node:crypto';

const CODE_VERSION = 1;
const ACTIONS = { reset: 1, level: 2, coins: 3, lives: 4, infinite: 5 };
const SECRET = ['chromaflask', 'support', 'v1', 'M9T4-VQ2H-XKZ7'].join(':');
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

function base32Encode(bytes) {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31];
  return out;
}

function normalizeSupportId(raw) {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

function fail(message) {
  console.error(`error: ${message}`);
  console.error('usage: node scripts/make-support-code.mjs <supportId> <reset|level N|coins N|lives|infinite H> [--days N]');
  process.exit(1);
}

const args = process.argv.slice(2);
let days = 14;
const dayFlag = args.indexOf('--days');
if (dayFlag !== -1) {
  days = Number(args[dayFlag + 1]);
  if (!Number.isInteger(days) || days < 1 || days > 365) fail('--days must be 1-365');
  args.splice(dayFlag, 2);
}

const [rawId, actionName, rawParam] = args;
if (!rawId || !actionName) fail('support ID and action are required');

const supportId = normalizeSupportId(rawId);
if (supportId.length !== 8) fail(`support ID should be 8 characters, got "${supportId}"`);

const action = ACTIONS[actionName];
if (!action) fail(`unknown action "${actionName}"`);

let param = 0;
if (actionName === 'level' || actionName === 'coins' || actionName === 'infinite') {
  param = Number(rawParam);
  if (!Number.isInteger(param) || param < 1 || param > 65535) {
    fail(`"${actionName}" needs a number between 1 and 65535`);
  }
}

const expDay = Math.floor(Date.now() / 86_400_000) + days;
if (expDay > 65535) fail('expiry overflows the uint16 day field');

const payload = Buffer.from([
  CODE_VERSION,
  action,
  (param >> 8) & 255,
  param & 255,
  (expDay >> 8) & 255,
  expDay & 255,
]);

const sig = createHmac('sha256', SECRET)
  .update(Buffer.concat([payload, Buffer.from(supportId, 'utf8')]))
  .digest()
  .subarray(0, 6);

const raw = base32Encode(Buffer.concat([payload, sig]));
const code = `CF-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;

const what = {
  reset: 'full progress reset',
  level: `unlock through level ${param}`,
  coins: `grant ${param} coins`,
  lives: 'refill hearts',
  infinite: `unlimited hearts for ${param}h`,
}[actionName];

console.log(code);
console.log(`  for:     ${supportId.slice(0, 4)}-${supportId.slice(4)}`);
console.log(`  does:    ${what}`);
console.log(`  expires: ${new Date((expDay + 1) * 86_400_000).toISOString().slice(0, 10)} (UTC)`);
console.log('  single-use on that device.');
