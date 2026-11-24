// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
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

// The sequence numbers of captured calls start over at 1 whenever the proxy
// process does. The dashboard script trusts a `bootId` field in the call list
// to notice that (its own test stubs the field); this pins the real response.
describe('proxy call list across a restart', () => {
  /** A port nothing is listening on right now. */
  async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as { port: number };
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
  }

  async function startProxy(port: number): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['proxy/server.mjs'], {
      env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`proxy exited with code ${child.exitCode}: ${stderr}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/__spy/api/calls`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return child;
      } catch { /* not listening yet */ }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    child.kill();
    throw new Error(`proxy did not start listening: ${stderr}`);
  }

  const callList = async (port: number): Promise<{ bootId: unknown; calls: unknown[] }> => {
    const res = await fetch(`http://127.0.0.1:${port}/__spy/api/calls?since=5`);
    return (await res.json()) as { bootId: unknown; calls: unknown[] };
  };

  it('names the process in every response, so a dashboard can tell a restart from a quiet proxy', async () => {
    const port = await freePort();
    const first = await startProxy(port);
    const before = await callList(port);
    first.kill();
    await new Promise<void>((resolve) => first.once('exit', resolve));

    const second = await startProxy(port);
    try {
      const after = await callList(port);
      expect(before.bootId).toEqual(expect.any(String));
      expect(before.bootId).not.toBe('');
      expect(after.bootId).not.toBe(before.bootId);
      expect(after.calls).toEqual([]);
    } finally {
      second.kill();
    }
  }, 30_000);
});
