import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function setupFakeLauncher(t, cliSource) {
  const root = mkdtempSync(join(tmpdir(), 'pkgsteward-run-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of ['scripts', 'apps/api', 'apps/web']) {
    mkdirSync(join(root, folder), { recursive: true });
  }
  const launcher = join(root, 'scripts', 'run-apps.mjs');
  const cli = join(root, 'cli.cjs');
  const eventsFile = join(root, 'events.log');
  copyFileSync(new URL('./run-apps.mjs', import.meta.url), launcher);
  writeFileSync(cli, cliSource);
  return { launcher, cli, eventsFile };
}

test('root dev and start never launch web if api exits before becoming ready', (t) => {
  const { launcher, cli, eventsFile } = setupFakeLauncher(
    t,
    [
      "const { appendFileSync } = require('node:fs');",
      "const { basename } = require('node:path');",
      "const app = basename(process.cwd());",
      "appendFileSync(process.env.TEST_EVENTS_FILE, `start:${app}\\n`);",
      "if (app === 'api') process.exit(Number(process.env.TEST_APP_EXIT));",
      'setTimeout(() => process.exit(98), 2000);',
    ].join('\n'),
  );

  for (const mode of ['dev', 'start']) {
    for (const [child, expected] of [
      [0, 1],
      [7, 7],
    ]) {
      writeFileSync(eventsFile, '');
      const result = spawnSync(process.execPath, [launcher, mode], {
        env: {
          ...process.env,
          npm_execpath: cli,
          npm_config_user_agent: 'yarn/1',
          PKGSTEWARD_NO_BROWSER: '1',
          TEST_APP_EXIT: String(child),
          TEST_EVENTS_FILE: eventsFile,
        },
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, expected, `${mode}: app exited ${child}`);
      assert.deepEqual(
        readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/),
        ['start:api'],
        `${mode}: web must not start when api exits early`,
      );
    }
  }
});

test('root dev and start launch web once only after api prints its ready line, and stop api when web exits', (t) => {
  const { launcher, cli, eventsFile } = setupFakeLauncher(
    t,
    [
      "const { appendFileSync } = require('node:fs');",
      "const { basename } = require('node:path');",
      "const app = basename(process.cwd());",
      "appendFileSync(process.env.TEST_EVENTS_FILE, `start:${app}\\n`);",
      "if (app === 'api') {",
      '  setTimeout(() => {',
      "    appendFileSync(process.env.TEST_EVENTS_FILE, 'ready:api\\n');",
      "    console.log('\\x1b[32mApplication is running on: http://127.0.0.1:24681/api/v1\\x1b[39m');",
      '  }, 150);',
      '  setTimeout(() => {',
      "    appendFileSync(process.env.TEST_EVENTS_FILE, 'reload:api\\n');",
      "    console.log('Application is running on: http://127.0.0.1:24681/api/v1');",
      '  }, 260);',
      '  setTimeout(() => process.exit(99), 4000);',
      '} else {',
      "  console.log('Local: http://127.0.0.1:24680');",
      "  console.log('Ready in 42 ms');",
      '  setTimeout(() => process.exit(Number(process.env.TEST_WEB_EXIT)), 250);',
      '}',
    ].join('\n'),
  );

  for (const mode of ['dev', 'start']) {
    for (const [webExit, expected] of [
      [0, 1],
      [7, 7],
    ]) {
      writeFileSync(eventsFile, '');
      const result = spawnSync(process.execPath, [launcher, mode], {
        env: {
          ...process.env,
          npm_execpath: cli,
          npm_config_user_agent: 'yarn/1',
          PKGSTEWARD_NO_BROWSER: '1',
          TEST_WEB_EXIT: String(webExit),
          TEST_EVENTS_FILE: eventsFile,
        },
        encoding: 'utf8',
        timeout: 6000,
      });
      assert.equal(result.error, undefined);
      assert.match(result.stderr, /stopping the other app/);
      assert.equal(result.status, expected, `${mode}: web exited ${webExit}`);
      const events = readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/);
      assert.deepEqual(events.slice(0, 3), ['start:api', 'ready:api', 'start:web']);
      assert.equal(
        events.filter((line) => line === 'start:web').length,
        1,
        `${mode}: reload must not spawn a second web process`,
      );
    }
  }
});

test('root dev never opens browser while start reports ready when both apps finish starting', (t) => {
  const { launcher, cli } = setupFakeLauncher(
    t,
    [
      "const { basename } = require('node:path');",
      "const app = basename(process.cwd());",
      "if (app === 'api') {",
      "  setTimeout(() => console.log('Application is running on: http://127.0.0.1:24681/api/v1'), 80);",
      '  setTimeout(() => process.exit(99), 4000);',
      '} else {',
      "  console.log('Local: invalid-not-loopback-so-no-browser-tab');",
      "  console.log('Ready in 10 ms');",
      '  setTimeout(() => process.exit(5), 150);',
      '}',
    ].join('\n'),
  );

  const env = {
    ...process.env,
    npm_execpath: cli,
    npm_config_user_agent: 'yarn/1',
  };
  delete env.PKGSTEWARD_NO_BROWSER;

  const devResult = spawnSync(process.execPath, [launcher, 'dev'], {
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(devResult.status, 5);
  assert.doesNotMatch(devResult.stdout, /Both apps are ready|Opening /);

  const startResult = spawnSync(process.execPath, [launcher, 'start'], {
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(startResult.status, 5);
  assert.match(startResult.stdout, /Both apps are ready/);
});
