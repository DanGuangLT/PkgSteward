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

const startupTimeoutMs = 3000;

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

test('root launcher rejects unknown commands before starting an app', (t) => {
  const { launcher, cli } = setupFakeLauncher(t, "console.log('unexpected app launch'); process.exit(17);");
  for (const args of [[], ['deploy'], ['toString'], ['constructor'], ['__proto__']]) {
    const result = spawnSync(process.execPath, [launcher, ...args], {
      env: { ...process.env, npm_execpath: cli, npm_config_user_agent: 'yarn/1' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^\[run-apps\] Task must be one of: dev, build, start/);
    assert.equal(result.stdout, '');
  }
});

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
          PKGSTEWARD_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
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
      "  appendFileSync(process.env.TEST_EVENTS_FILE, 'ready:api\\n');",
      "  console.log('\\x1b[32mApplication is running on: http://127.0.0.1:24681/api/v1\\x1b[39m\\nApplication is running on: http://127.0.0.1:24681/api/v1');",
      '  setTimeout(() => process.exit(99), 10000);',
      '} else {',
      "  console.log('Local: http://127.0.0.1:24680');",
      "  console.log('Ready in 42 ms');",
      '  setTimeout(() => process.exit(Number(process.env.TEST_WEB_EXIT)), Number(process.env.TEST_WEB_EXIT_DELAY_MS));',
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
          PKGSTEWARD_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
          TEST_WEB_EXIT: String(webExit),
          // Exercise clearing both readiness timers when the apps stay up past the deadline.
          TEST_WEB_EXIT_DELAY_MS: String(mode === 'dev' && webExit === 7 ? startupTimeoutMs + 250 : 250),
          TEST_EVENTS_FILE: eventsFile,
        },
        encoding: 'utf8',
        timeout: 12000,
      });
      assert.equal(result.error, undefined);
      assert.match(result.stderr, /stopping the other app/);
      assert.equal(result.status, expected, `${mode}: web exited ${webExit}`);
      const events = readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/);
      assert.deepEqual(events, ['start:api', 'ready:api', 'start:web']);
      const output = result.stdout.split(/\r?\n/);
      const apiReady = (line) => line.startsWith('[api]') && line.includes('Application is running on:');
      const webLaunch = output.findIndex((line) => line.startsWith('[run-apps]') && line.endsWith('in apps/web'));
      assert.equal(output.filter(apiReady).length, 2);
      assert.ok(webLaunch > output.findIndex(apiReady), 'the launcher must receive API readiness before starting Web');
    }
  }
});

test('startup times out a stalled app and stops each process it launched', (t) => {
  const { launcher, cli, eventsFile } = setupFakeLauncher(
    t,
    [
      "const { appendFileSync } = require('node:fs');",
      "const { basename } = require('node:path');",
      "const app = basename(process.cwd());",
      "appendFileSync(process.env.TEST_EVENTS_FILE, `${app}:${process.pid}\\n`);",
      "if (app === 'api' && process.env.TEST_STALLED_APP === 'web') {",
      "  console.log('Application is running on: http://127.0.0.1:24681/api/v1');",
      '}',
      // Let the fixture exit on its own if the launcher never terminates it.
      'setTimeout(() => process.exit(99), 10000);',
    ].join('\n'),
  );

  for (const mode of ['dev', 'start']) {
    for (const stalled of ['api', 'web']) {
      writeFileSync(eventsFile, '');
      const result = spawnSync(process.execPath, [launcher, mode], {
        env: {
          ...process.env,
          npm_execpath: cli,
          npm_config_user_agent: 'yarn/1',
          PKGSTEWARD_NO_BROWSER: '1',
          PKGSTEWARD_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
          TEST_EVENTS_FILE: eventsFile,
          TEST_STALLED_APP: stalled,
        },
        encoding: 'utf8',
        timeout: 12000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, `${mode}: ${stalled} stalled`);
      assert.match(result.stderr, new RegExp(`apps/${stalled} did not become ready within ${startupTimeoutMs} ms`));
      const children = readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).map((line) => line.split(':'));
      assert.deepEqual(children.map(([app]) => app), stalled === 'api' ? ['api'] : ['api', 'web']);
      for (const [, pid] of children) {
        assert.throws(() => process.kill(Number(pid), 0), { code: 'ESRCH' });
      }
    }
  }
});

test('an invalid startup timeout fails before any app launches', (t) => {
  const { launcher, cli } = setupFakeLauncher(t, "console.log('unexpected app launch'); process.exit(17);");
  for (const timeout of ['0', '-1', '1.5', 'invalid', '2147483648']) {
    const result = spawnSync(process.execPath, [launcher, 'dev'], {
      env: {
        ...process.env,
        npm_execpath: cli,
        npm_config_user_agent: 'yarn/1',
        PKGSTEWARD_STARTUP_TIMEOUT_MS: timeout,
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, timeout);
    assert.match(result.stderr, /PKGSTEWARD_STARTUP_TIMEOUT_MS/);
    assert.doesNotMatch(result.stdout, /unexpected app launch/);
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
    PKGSTEWARD_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
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
