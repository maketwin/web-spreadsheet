import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pbkdf2 } from '../../src/protection/pbkdf2';

const enc = new TextEncoder();
const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// Cross-check the dependency-free implementation against the platform's
// reference PBKDF2 across iteration counts and multibyte inputs.
describe('pbkdf2-hmac-sha256 (cross-check vs node:crypto)', () => {
  it('matches pbkdf2Sync for every fixture', () => {
    const cases: Array<[string, string, number]> = [
      ['password', 'salt', 1],
      ['password', 'salt', 2],
      ['password', 'salt', 4096],
      ['pass\0word', 'sa\0lt', 16],
      ['密码🔐测试', '盐值', 3],
      ['password', 'salt', 100],
    ];
    for (const [password, salt, iterations] of cases) {
      const ours = hex(pbkdf2(enc.encode(password), enc.encode(salt), iterations));
      const ref = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
      expect(ours, `c=${iterations} p=${JSON.stringify(password)}`).toBe(ref);
    }
  });

  it('handles keys longer than the HMAC block size (64 bytes)', () => {
    const long = 'x'.repeat(100);
    expect(hex(pbkdf2(enc.encode(long), enc.encode('salt'), 7)))
      .toBe(pbkdf2Sync(long, 'salt', 7, 32, 'sha256').toString('hex'));
  });
});
