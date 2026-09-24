import { describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/util/passwordHash';

describe('hashPassword', () => {
  it('is deterministic and input-sensitive', () => {
    expect(hashPassword('abc')).toBe(hashPassword('abc'));
    expect(hashPassword('abc')).not.toBe(hashPassword('abd'));
    expect(hashPassword('')).not.toBe(hashPassword('a'));
  });

  it('returns the fnv1a-prefixed format', () => {
    expect(hashPassword('x').startsWith('fnv1a-')).toBe(true);
  });
});
