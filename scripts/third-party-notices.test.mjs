import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';

function setupNotices(t, responses = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pkgsteward-notices-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of ['scripts', 'apps/api', 'apps/web', 'bin']) {
    mkdirSync(join(root, folder), { recursive: true });
  }

  const script = join(root, 'scripts', 'third-party-notices.mjs');
  const bin = join(root, 'bin');
  copyFileSync(new URL('./third-party-notices.mjs', import.meta.url), script);
  const data = {
    'Example\nLicense': [{
      name: 'fixture-package',
      versions: ['1.0.0'],
      author: 'Ada\r\nLovelace | Team',
      homepage: 'https://example.invalid/docs\nReadme',
    }],
  };
  writeFileSync(join(bin, 'fixtures.json'), JSON.stringify({ default: { output: JSON.stringify(data) }, ...responses }));
  writeFileSync(join(bin, 'fake-pnpm.cjs'), [
    "const { basename } = require('node:path');",
    "const fixtures = require('./fixtures.json');",
    'const { output, status } = fixtures[basename(process.cwd())] ?? fixtures.default;',
    'process.stdout.write(output);',
    'process.exitCode = status ?? 0;',
  ].join('\n'));
  writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\nnode "%~dp0fake-pnpm.cjs"\r\n');
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexec node "$(dirname "$0")/fake-pnpm.cjs"\n', { mode: 0o755 });
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = [bin, dirname(process.execPath), env[pathKey]].filter(Boolean).join(delimiter);

  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, timeout: 5000 });
    assert.equal(result.error, undefined);
    return result;
  };
  return { run, noticePath: join(root, 'THIRD_PARTY_NOTICES.md') };
}

test('generated notices keep multiline dependency metadata on one Markdown line', (t) => {
  const { run, noticePath } = setupNotices(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const notice = readFileSync(noticePath, 'utf8');
  assert.match(notice, /^### Example License \(1\)$/m);
  assert.ok(notice.includes('| fixture-package | 1.0.0 | Ada Lovelace \\| Team | https://example.invalid/docs Readme |'));
  assert.match(notice, /^\| fixture-package \| 1\.0\.0 \| @pkgsteward\/api \| Example License \|/m);
});

test('notice check reports stale or missing output without rewriting it', (t) => {
  const { run, noticePath } = setupNotices(t);
  const missing = run('--check');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /THIRD_PARTY_NOTICES\.md is missing/);
  assert.throws(() => readFileSync(noticePath), { code: 'ENOENT' });

  const staleContent = 'Old notices\n';
  writeFileSync(noticePath, staleContent);
  const stale = run('--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /THIRD_PARTY_NOTICES\.md is out of date/);
  assert.equal(readFileSync(noticePath, 'utf8'), staleContent);

  const generated = run();
  assert.equal(generated.status, 0, generated.stderr);
  const currentContent = readFileSync(noticePath, 'utf8').replaceAll('\n', '\r\n');
  writeFileSync(noticePath, currentContent);
  const current = run('--check');
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /THIRD_PARTY_NOTICES\.md is up to date/);
  assert.equal(readFileSync(noticePath, 'utf8'), currentContent);
});

const listingFailures = [
  {
    name: 'pnpm license listing fails with a structured error',
    responses: { api: { status: 7, output: JSON.stringify({ error: { message: 'Fixture dependency is missing' } }) } },
    message: '[third-party-notices] apps/api: pnpm license listing failed: Fixture dependency is missing',
  },
  {
    name: 'pnpm license listing fails without a structured error',
    responses: { web: { status: 8, output: '' } },
    message: '[third-party-notices] apps/web: pnpm license listing failed: exit code 8',
  },
  {
    name: 'pnpm license listing returns invalid JSON',
    responses: { web: { output: '{not JSON' } },
    message: '[third-party-notices] apps/web: pnpm license listing returned invalid JSON.',
  },
];

for (const { name, responses, message } of listingFailures) {
  test(name, (t) => {
    const { run, noticePath } = setupNotices(t, responses);
    const existing = Buffer.from('Existing notices\r\n', 'utf8');
    writeFileSync(noticePath, existing);

    for (const args of [[], ['--check']]) {
      const result = run(...args);
      assert.equal(result.status, 1);
      assert.equal(result.stderr.trim(), message);
      assert.equal(result.stdout, '');
      assert.deepEqual(readFileSync(noticePath), existing);
    }
  });
}
