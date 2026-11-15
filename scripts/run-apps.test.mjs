import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('parallel root commands fail if an app exits on its own', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pkgsteward-run-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of ['scripts', 'apps/api', 'apps/web']) {
    mkdirSync(join(root, folder), { recursive: true });
  }
  const launcher = join(root, 'scripts', 'run-apps.mjs');
  const cli = join(root, 'cli.cjs');
  copyFileSync(new URL('./run-apps.mjs', import.meta.url), launcher);
  writeFileSync(cli, [
    "const { basename } = require('node:path');",
    "if (basename(process.cwd()) === 'api') process.exit(Number(process.env.TEST_APP_EXIT));",
    'setTimeout(() => process.exit(98), 2000);',
  ].join('\n'));

  for (const mode of ['dev', 'start']) {
    for (const [child, expected] of [[0, 1], [7, 7]]) {
      const result = spawnSync(process.execPath, [launcher, mode], {
        env: { ...process.env, npm_execpath: cli, npm_config_user_agent: 'yarn/1',
          PKGSTEWARD_NO_BROWSER: '1', TEST_APP_EXIT: String(child) },
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.match(result.stderr, /stopping the other app/);
      assert.equal(result.status, expected, `${mode}: app exited ${child}`);
    }
  }
});
