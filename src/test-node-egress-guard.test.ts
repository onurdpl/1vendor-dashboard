import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const guardPath = resolve(process.cwd(), 'scripts/test-node-egress-guard.mjs');

function probe(source: string) {
  return spawnSync(process.execPath, ['--import', guardPath, '--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('test-only Node egress guard', () => {
  it('allows a local HTTP server and client', () => {
    const result = probe(`
      import http from 'node:http';
      import assert from 'node:assert/strict';
      const server = http.createServer((_request, response) => response.end('local-ok'));
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port);
        assert.equal(await response.text(), 'local-ok');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    `);
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects external fetch, HTTP, HTTPS, raw TCP, and TLS before connection', () => {
    const result = probe(`
      import assert from 'node:assert/strict';
      import http from 'node:http';
      import https from 'node:https';
      import net from 'node:net';
      import tls from 'node:tls';
      const blocked = /EXTERNAL EGRESS BLOCKED/;
      assert.throws(() => fetch('https://egress-probe.invalid/fetch'), blocked);
      assert.throws(() => http.request('http://egress-probe.invalid/http'), blocked);
      assert.throws(() => http.get('http://egress-probe.invalid/get'), blocked);
      assert.throws(() => https.request('https://egress-probe.invalid/https'), blocked);
      assert.throws(() => https.get('https://egress-probe.invalid/get'), blocked);
      assert.throws(() => net.connect(443, 'egress-probe.invalid'), blocked);
      assert.throws(() => tls.connect(443, 'egress-probe.invalid'), blocked);
    `);
    expect(result.status, result.stderr).toBe(0);
  });
});
