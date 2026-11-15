import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('the root installer forwards an explicit non-interactive flag only to Yarn', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pkgsteward-install-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of ['scripts', 'apps/api', 'apps/web']) {
    mkdirSync(join(root, folder), { recursive: true });
  }
  const installer = join(root, 'scripts', 'install-apps.mjs');
  const cli = join(root, 'cli.cjs');
  copyFileSync(new URL('./install-apps.mjs', import.meta.url), installer);
  writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');

  const cases = [
    ['yarn', '{"original":["install","--non-interactive"]}', ['install', '--non-interactive']],
    ['yarn', '{"original":["install"]}', ['install']],
    ['yarn', 'invalid JSON', ['install']],
    ['npm', '{"original":["install","--non-interactive"]}', ['install']],
    ['pnpm', '{"original":["install","--non-interactive"]}', ['install']],
  ];
  for (const [manager, argv, expected] of cases) {
    const result = spawnSync(process.execPath, [installer], {
      env: { ...process.env, npm_config_user_agent: `${manager}/1`, npm_execpath: cli, npm_config_argv: argv },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const commands = result.stdout.split(/\r?\n/).filter((line) => line.startsWith('["')).map((line) => JSON.parse(line));
    assert.deepEqual(commands, [expected, expected], `${manager}: ${argv}`);
  }
});
