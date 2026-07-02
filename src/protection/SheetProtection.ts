/** Sheet protection state stored per sheet. */
export interface SheetProtectionState {
  readonly protected: boolean;
  readonly passwordHash: string;
}

/** Simple hash for MVP — btoa encoding. */
export function hashPassword(password: string): string {
  return btoa(password);
}

/** Verify a password against the stored hash. */
export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

/** Create a protected state from a password. */
export function protectSheet(password: string): SheetProtectionState {
  return { protected: true, passwordHash: hashPassword(password) };
}

/** Create an unprotected state. */
export function unprotectSheet(): SheetProtectionState {
  return { protected: false, passwordHash: '' };
}
