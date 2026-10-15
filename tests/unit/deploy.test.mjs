// Deployment safety: the security headers in render.yaml match the code, and unsafe production builds are refused.
//
//   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SECURITY_HEADERS } from '../../scripts/security-headers.mjs';

describe('security headers', () => {
  const yaml = fs.readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  test('render.yaml serves every header defined in scripts/security-headers.mjs', () => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.ok(yaml.includes(`name: ${name}\n        value: ${value}\n`), `${name} is missing or out of date in render.yaml`);
    }
  });

  test('the content security policy blocks the dangerous defaults', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);
  });
});

describe('build guard', () => {
  // each build takes a couple of seconds, so these run the real vite build into a temp folder
  function build(env) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-build-'));
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
    const r = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], {
      env: { ...clean, ...env }, encoding: 'utf8', shell: process.platform === 'win32', cwd: new URL('../../', import.meta.url),
    });
    fs.rmSync(out, { recursive: true, force: true });
    return { ok: r.status === 0, output: `${r.stdout}\n${r.stderr}` };
  }

  test('a production build may not use the local test backend', () => {
    const r = build({ VITE_APP_MODE: 'production', VITE_BACKEND: 'local' });
    assert.equal(r.ok, false);
    assert.match(r.output, /must never be used in a production build/);
  });

  test('production mode needs the Supabase settings', () => {
    const r = build({ VITE_APP_MODE: 'production', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' });
    assert.equal(r.ok, false);
    assert.match(r.output, /needs VITE_SUPABASE_URL/);
  });

  test('a service-role key in any VITE_ variable stops the build', () => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const r = build({ VITE_SUPABASE_ANON_KEY: `${b({ alg: 'HS256' })}.${b({ role: 'service_role' })}.sig` });
    assert.equal(r.ok, false);
    assert.match(r.output, /service-role key/);
  });

  test('an anon key and the demo build still succeed', () => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const r = build({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: `${b({ alg: 'HS256' })}.${b({ role: 'anon' })}.sig` });
    assert.equal(r.ok, true, r.output);
  });
});
