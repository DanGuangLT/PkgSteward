import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';

test('generated notices keep multiline dependency metadata on one Markdown line', (t) => {
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
  writeFileSync(join(bin, 'data.json'), JSON.stringify(data));
  writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\ntype "%~dp0data.json"\r\n');
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\ncat "$(dirname "$0")/data.json"\n', { mode: 0o755 });
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = [bin, dirname(process.execPath), env[pathKey]].filter(Boolean).join(delimiter);

  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env, timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const notice = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notice, /^### Example License \(1\)$/m);
  assert.ok(notice.includes('| fixture-package | 1.0.0 | Ada Lovelace \\| Team | https://example.invalid/docs Readme |'));
  assert.match(notice, /^\| fixture-package \| 1\.0\.0 \| @pkgsteward\/api \| Example License \|/m);
});
