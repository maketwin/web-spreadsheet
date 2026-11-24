/** Request guards of the local reverse proxy (see proxy/server.mjs). */

/** True for a request path that stays on this proxy (`/x`, not `//host/x`). */
export function isLocalTarget(path: string | undefined): boolean;

/** True when `host` is the address this proxy itself listens on. */
export function isLocalHostHeader(host: string | undefined, port: number): boolean;
