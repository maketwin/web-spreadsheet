import { pbkdf2, sha256Bytes } from './pbkdf2';

/** Sheet protection state stored per sheet. */
export interface SheetProtectionState {
  readonly protected: boolean;
  readonly passwordHash: string;
}

/**
 * Salted PBKDF2 digest iterations. Sheet protection is an obfuscation
 * feature (like Excel's own); the count is tuned to keep the synchronous
 * hash under ~200 ms while still making offline reversal expensive.
 */
const ITERATIONS = 20_000;
/** Untrusted workbooks must not be able to pin the UI with a huge iteration count. */
const MAX_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const FORMAT = 'pbkdf2-sha256';

const encoder = new TextEncoder();

/** Salted PBKDF2 hash, UTF-8 safe (Chinese/emoji passwords supported). */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES, password);
  const digest = pbkdf2(encoder.encode(password), salt, ITERATIONS);
  return `${FORMAT}$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(digest)}`;
}

/** Verify a password against a stored hash; accepts legacy Base64 hashes too. */
export function verifyPassword(password: string, hash: string): boolean {
  if (hash.length === 0) return false;
  const parts = hash.split('$');
  if (parts[0] === FORMAT && parts.length === 4) {
    const iterations = Number(parts[1]);
    const salt = base64ToBytes(parts[2] ?? '');
    const expected = base64ToBytes(parts[3] ?? '');
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS || salt.length === 0 || expected.length === 0) return false;
    const digest = pbkdf2(encoder.encode(password), salt, iterations);
    return constantTimeEquals(digest, expected);
  }
  // Legacy (pre-PBKDF2) hashes were plain btoa(password).
  try {
    return typeof atob === 'function' ? atob(hash) === password : false;
  } catch {
    return false;
  }
}

/** Create a protected state from a password. */
export function protectSheet(password: string): SheetProtectionState {
  return { protected: true, passwordHash: hashPassword(password) };
}

/** Create an unprotected state. */
export function unprotectSheet(): SheetProtectionState {
  return { protected: false, passwordHash: '' };
}

let fallbackSaltCounter = 0;

function randomBytes(n: number, password: string): Uint8Array {
  const rng = globalThis.crypto;
  if (rng?.getRandomValues !== undefined) {
    const out = new Uint8Array(n);
    rng.getRandomValues(out);
    return out;
  }
  // No CSPRNG available (non-browser host): mix several entropy sources
  // through SHA-256 instead of trusting a single Math.random draw.
  fallbackSaltCounter += 1;
  const material = `${password}\u0000${Date.now()}\u0000${performance.now()}\u0000${Math.random()}\u0000${fallbackSaltCounter}`;
  return sha256Bytes(encoder.encode(material)).slice(0, n);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  try {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
