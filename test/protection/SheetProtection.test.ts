import { describe, it, expect } from 'vitest';
import { hashPassword, protectSheet, unprotectSheet, verifyPassword } from '../../src/protection/SheetProtection';
import { pbkdf2 } from '../../src/protection/pbkdf2';
import { Store } from '../../src/store/Store';

const enc = new TextEncoder();
const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// Known-answer vectors pin the KDF implementation itself; the tiny iteration
// counts are the published fixtures, not production parameters.
describe('pbkdf2-hmac-sha256 (known vectors)', () => {
  it('derives the published digests for P="password", S="salt"', () => {
    expect(hex(pbkdf2(enc.encode('password'), enc.encode('salt'), 1)))
      .toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
    expect(hex(pbkdf2(enc.encode('password'), enc.encode('salt'), 2)))
      .toBe('ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
  });

  it('derives the c=4096 vector', () => {
    expect(hex(pbkdf2(enc.encode('password'), enc.encode('salt'), 4096)))
      .toBe('c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a');
  });

  it('handles multi-byte UTF-8 passwords and salts deterministically', () => {
    const a = pbkdf2(enc.encode('pass\u0000word'), enc.encode('sa\u0000lt'), 16);
    expect(hex(pbkdf2(enc.encode('pass\u0000word'), enc.encode('sa\u0000lt'), 16))).toBe(hex(a));
    expect(hex(pbkdf2(enc.encode('password'), enc.encode('salt'), 16))).not.toBe(hex(a));
  });
});

describe('SheetProtection', () => {
  it('hashes with a salted PBKDF2 digest, not a reversible encoding', () => {
    const hash = hashPassword('secret');
    expect(hash.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(hash).not.toContain('secret');
    // Two hashes of the same password differ (random salt).
    expect(hashPassword('secret')).not.toBe(hash);
  });

  it('supports non-Latin1 passwords (Chinese, emoji) without throwing', () => {
    const pwd = '密码🔐测试';
    expect(verifyPassword(pwd, hashPassword(pwd))).toBe(true);
    expect(verifyPassword('密码', hashPassword(pwd))).toBe(false);
  });

  it('verifies correct password and rejects wrong ones', () => {
    const hash = hashPassword('mypassword');
    expect(verifyPassword('mypassword', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
    expect(verifyPassword('mypassword', 'not-a-hash')).toBe(false);
    expect(verifyPassword('mypassword', '')).toBe(false);
  });

  it('still verifies legacy Base64 hashes from saved workbooks', () => {
    expect(verifyPassword('legacy', btoa('legacy'))).toBe(true);
    expect(verifyPassword('other', btoa('legacy'))).toBe(false);
  });

  it('protects and unprotects via store', () => {
    const store = new Store();
    expect(store.isSheetProtected()).toBe(false);

    store.setProtection(protectSheet('pass'));
    expect(store.isSheetProtected()).toBe(true);

    const prot = store.getProtection();
    expect(prot?.protected).toBe(true);
    expect(verifyPassword('pass', prot?.passwordHash ?? '')).toBe(true);

    store.setProtection(unprotectSheet());
    expect(store.isSheetProtected()).toBe(false);
  });
});
