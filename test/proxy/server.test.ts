import { describe, expect, it } from 'vitest';
import { isLocalHostHeader, isLocalTarget } from '../../proxy/server.mjs';

// The proxy forwards request headers (session cookies included) to whatever
// host the request line names, and its /__spy endpoints expose captured
// traffic — both must stay reachable for this proxy's own address only.
describe('proxy request guards', () => {
  it('accepts plain paths only', () => {
    expect(isLocalTarget('/oa/login?x=1')).toBe(true);
    expect(isLocalTarget('/__spy/api/calls?since=3')).toBe(true);
    // Each of these resolves to another host when parsed against the upstream origin.
    expect(isLocalTarget('//evil.example/x')).toBe(false);
    expect(isLocalTarget('/\\evil.example/x')).toBe(false);
    expect(isLocalTarget('http://evil.example/x')).toBe(false);
    expect(isLocalTarget('https:evil.example/x')).toBe(false);
    expect(isLocalTarget(undefined)).toBe(false);
  });

  it('accepts only the proxy own Host header', () => {
    expect(isLocalHostHeader('127.0.0.1:8787', 8787)).toBe(true);
    expect(isLocalHostHeader('localhost:8787', 8787)).toBe(true);
    expect(isLocalHostHeader('[::1]:8787', 8787)).toBe(true);
    expect(isLocalHostHeader('evil.example:8787', 8787)).toBe(false);
    expect(isLocalHostHeader('127.0.0.1:9999', 8787)).toBe(false);
    expect(isLocalHostHeader('evil.example', 8787)).toBe(false);
    expect(isLocalHostHeader(undefined, 8787)).toBe(false);
  });
});
