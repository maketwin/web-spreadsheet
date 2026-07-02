import { describe, it, expect } from 'vitest';
import { hashPassword, protectSheet, unprotectSheet, verifyPassword } from '../../src/protection/SheetProtection';
import { Store } from '../../src/store/Store';

describe('SheetProtection', () => {
  it('hashes a password with btoa', () => {
    expect(hashPassword('secret')).toBe(btoa('secret'));
    expect(hashPassword('')).toBe(btoa(''));
    expect(hashPassword('test123')).toBe(btoa('test123'));
  });

  it('verifies correct password', () => {
    const hash = hashPassword('mypassword');
    expect(verifyPassword('mypassword', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
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
