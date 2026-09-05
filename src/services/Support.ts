/**
 * Email-support tooling for a game with no backend.
 *
 * The player's save lives only in their browser, so support cannot reach in
 * remotely. Instead the player emails us their support ID (shown in Settings),
 * we answer with a short signed code (scripts/make-support-code.mjs), and the
 * game verifies and applies it locally. Codes are bound to one support ID and
 * expire, so a code mailed to one player is useless to anyone else.
 *
 * Known trade-off, accepted for a single-player casual game: the signing
 * secret ships in the bundle, so a determined reader of this source can forge
 * codes for themselves - exactly as they can already edit localStorage.
 * Revisit if real-money stakes or competitive leaderboards ever depend on it.
 */

import type { SaveService } from './SaveService';

export const SUPPORT_EMAIL = 'tomboban77@gmail.com';

// --------------------------------------------------------------- code format
//
// payload (6 bytes): version, action, param uint16 BE, expiry-day uint16 BE
// sig (6 bytes): HMAC-SHA256(secret, payload + supportId), truncated
// code: base32(payload + sig) = 20 chars, shown as CF-XXXXX-XXXXX-XXXXX-XXXXX
//
// KEEP IN SYNC with scripts/make-support-code.mjs (same layout, same secret).

const CODE_VERSION = 1;

export const SUPPORT_ACTIONS = {
  reset: 1,
  level: 2,
  coins: 3,
  lives: 4,
  infinite: 5,
} as const;

export type SupportAction = keyof typeof SUPPORT_ACTIONS;

/** Assembled at runtime so the secret is not one grep-able literal. */
const SECRET = ['chromaflask', 'support', 'v1', 'M9T4-VQ2H-XKZ7'].join(':');

/** Crockford-style base32: no I, L, O, U, so codes survive handwriting. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

// Encoding lives only in scripts/make-support-code.mjs; the client just decodes.
function base32Decode(text: string, byteLength: number): Uint8Array | null {
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of text) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  if (out.length !== byteLength) return null;
  return new Uint8Array(out);
}

/** Uppercase, strip separators/prefix, and undo the confusable letters. */
export function normalizeCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  return cleaned.startsWith('CF') && cleaned.length === 22 ? cleaned.slice(2) : cleaned;
}

async function signature(payload: Uint8Array, supportId: string): Promise<Uint8Array | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null; // non-secure context; support codes just unavailable
  const enc = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = new Uint8Array(payload.length + supportId.length);
  message.set(payload);
  message.set(enc.encode(supportId), payload.length);
  const mac = new Uint8Array(await subtle.sign('HMAC', key, message));
  return mac.slice(0, 6);
}

export interface DecodedSupportCode {
  action: SupportAction;
  param: number;
  /** Normalized 20-char form, recorded to block replaying the same code. */
  normalized: string;
}

export type SupportCodeError = 'malformed' | 'invalid' | 'expired' | 'used' | 'unsupported';

export type SupportCodeResult =
  | { ok: true; code: DecodedSupportCode }
  | { ok: false; reason: SupportCodeError };

export async function verifySupportCode(
  raw: string,
  supportId: string,
  usedCodes: readonly string[],
): Promise<SupportCodeResult> {
  const normalized = normalizeCode(raw);
  const bytes = normalized.length === 20 ? base32Decode(normalized, 12) : null;
  if (!bytes) return { ok: false, reason: 'malformed' };

  const payload = bytes.slice(0, 6);
  const expected = await signature(payload, supportId);
  if (!expected) return { ok: false, reason: 'unsupported' };

  let diff = 0;
  for (let i = 0; i < 6; i++) diff |= (bytes[6 + i] as number) ^ (expected[i] as number);
  if (diff !== 0 || payload[0] !== CODE_VERSION) return { ok: false, reason: 'invalid' };

  const expDay = ((payload[4] as number) << 8) | (payload[5] as number);
  if (Math.floor(Date.now() / 86_400_000) > expDay) return { ok: false, reason: 'expired' };
  if (usedCodes.includes(normalized)) return { ok: false, reason: 'used' };

  const actionByte = payload[1];
  const action = (Object.keys(SUPPORT_ACTIONS) as SupportAction[]).find(
    (name) => SUPPORT_ACTIONS[name] === actionByte,
  );
  if (!action) return { ok: false, reason: 'invalid' };

  const param = ((payload[2] as number) << 8) | (payload[3] as number);
  return { ok: true, code: { action, param, normalized } };
}

export interface AppliedSupportCode {
  /** What was applied; the UI phrases it in the player's language. */
  action: SupportAction;
  /** The effective parameter (clamped level, coins, hours). */
  param: number;
  /** Full reset wants a reload so every screen restarts from the new save. */
  reload: boolean;
}

/** Applies a verified code and marks it used. Caller flushes/reloads. */
export function applySupportCode(
  code: DecodedSupportCode,
  save: SaveService,
  levelCount: number,
): AppliedSupportCode {
  save.markSupportCodeUsed(code.normalized);
  switch (code.action) {
    case 'reset':
      save.resetProgress();
      return { action: 'reset', param: 0, reload: true };
    case 'level': {
      const target = Math.min(Math.max(code.param, 1), levelCount);
      save.unlockThroughLevel(target);
      return { action: 'level', param: target, reload: false };
    }
    case 'coins':
      save.addCoins(code.param);
      return { action: 'coins', param: code.param, reload: false };
    case 'lives':
      save.refillLives();
      return { action: 'lives', param: 0, reload: false };
    case 'infinite':
      save.addInfiniteLives(code.param);
      return { action: 'infinite', param: code.param, reload: false };
  }
}

// ------------------------------------------------------------- email helper

/** XXXX-XXXX, easier to read aloud or retype from a screenshot. */
export function formatSupportId(id: string): string {
  return id.length === 8 ? `${id.slice(0, 4)}-${id.slice(4)}` : id;
}

export function supportMailto(supportId: string, highestLevel: number, saveVersion: number): string {
  const subject = `ChromaFlask support (${formatSupportId(supportId)})`;
  const body = [
    'Tell us what went wrong:',
    '',
    '',
    '----- please keep this part -----',
    `Support ID: ${formatSupportId(supportId)}`,
    `Progress: level ${highestLevel}`,
    `Save version: ${saveVersion}`,
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
