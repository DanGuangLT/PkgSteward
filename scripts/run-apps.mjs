#!/usr/bin/env node
// Runs `dev`, `build` or `start` for apps/api and apps/web with the package manager that started the
// root script (`npm run dev`, `pnpm dev`, `yarn dev`, ...). `dev` and `start` always launch apps/api
// first and start apps/web only after the backend reports ready (output prefixed [api] / [web]);
// `build` builds them sequentially. `start` also opens the web UI in the default browser once both
// apps are ready.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Script to run inside each app for every root command.
const tasks = {
  dev: { sequential: false, apps: [['api', 'dev'], ['web', 'dev']] },
  build: { sequential: true, apps: [['api', 'build'], ['web', 'build']] },
  start: { sequential: false, openBrowser: true, apps: [['api', 'start:prod'], ['web', 'start']] },
};

// Log line each app prints once it accepts requests (apps/api main.ts, Next.js).
const readyLines = { api: /Application is running on:/, web: /\bReady in\b/ };

const taskName = process.argv[2];
if (!Object.hasOwn(tasks, taskName)) {
  console.error(`[run-apps] Task must be one of: ${Object.keys(tasks).join(', ')} (got ${JSON.stringify(taskName)}).`);
  process.exit(1);
}
const task = tasks[taskName];

// Every supported package manager sets these for scripts:
// npm_config_user_agent = "<name>/<version> ..." and npm_execpath = the CLI file that is running.
const manager = (process.env.npm_config_user_agent ?? '').split('/')[0];
const cli = process.env.npm_execpath;
if (!['npm', 'pnpm', 'yarn'].includes(manager) || !cli) {
  console.error(`[run-apps] Run "npm run ${taskName}", "pnpm ${taskName}" or "yarn ${taskName}" at the repository root.`);
  process.exit(1);
}

// Call the same CLI without a shell: a JavaScript entry runs on the current Node binary.
const isScript = ['.js', '.cjs', '.mjs'].includes(extname(cli).toLowerCase());
const command = isScript ? process.execPath : cli;
const installArgs = isScript ? [cli, 'install'] : ['install'];
const runArgs = (script) => (isScript ? [cli, 'run', script] : ['run', script]);

function ensureProductionBuilds() {
  const expected = ['apps/api/dist/main.js', 'apps/web/.next/BUILD_ID'];
  const missing = expected.filter((file) => !existsSync(join(root, file)));
  if (missing.length === 0) return;

  const buildCommand = manager === 'npm' ? 'npm run build' : `${manager} build`;
  console.error(`[run-apps] Missing production build: ${missing.join(', ')}. Run "${buildCommand}" at the repository root first.`);
  process.exit(1);
}

if (task.sequential) {
  ensureInstalled(task.apps);
  runSequential(task.apps);
} else {
  const startupTimeoutMs = Number(process.env.PKGSTEWARD_STARTUP_TIMEOUT_MS ?? 120_000);
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 2_147_483_647) {
    console.error('[run-apps] PKGSTEWARD_STARTUP_TIMEOUT_MS must be an integer from 1 to 2147483647.');
    process.exit(1);
  }
  if (taskName === 'start') ensureProductionBuilds();
  ensureInstalled(task.apps);
  runServices(task.apps, task.openBrowser === true && !process.env.PKGSTEWARD_NO_BROWSER, startupTimeoutMs);
}

function findMissingDependency(app, appDir) {
  const manifestPath = join(appDir, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new TypeError('Expected a JSON object.');
    }
  } catch (error) {
    console.error(`[run-apps] Invalid apps/${app}/package.json: ${error.message}`);
    process.exit(1);
  }
  const packages = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  return packages.find(
    (pkg) => !existsSync(join(appDir, 'node_modules', ...pkg.split('/'), 'package.json')),
  );
}

function ensureInstalled(apps) {
  for (const [app] of apps) {
    const appDir = join(root, 'apps', app);
    if (!findMissingDependency(app, appDir)) continue;
    console.log(`\n[run-apps] ${manager} install in apps/${app}`);
    const result = spawnSync(command, installArgs, { cwd: appDir, stdio: 'inherit' });
    if (result.status !== 0) {
      const reason = result.error ? `: ${result.error.message}` : ` (exit code ${result.status})`;
      console.error(`[run-apps] ${manager} install failed in apps/${app}${reason}`);
      process.exit(result.status || 1);
    }
    const missing = findMissingDependency(app, appDir);
    if (missing) {
      console.error(`[run-apps] apps/${app}: ${missing} is still missing after ${manager} install.`);
      process.exit(1);
    }
  }
}

function runSequential(apps) {
  for (const [app, script] of apps) {
    console.log(`\n[run-apps] ${manager} run ${script} in apps/${app}`);
    const result = spawnSync(command, runArgs(script), { cwd: join(root, 'apps', app), stdio: 'inherit' });
    if (result.status !== 0) {
      const reason = result.error ? `: ${result.error.message}` : ` (exit code ${result.status})`;
      console.error(`[run-apps] ${manager} run ${script} failed in apps/${app}${reason}`);
      process.exit(result.status || 1);
    }
  }
}

function runServices(apps, openBrowser, startupTimeoutMs) {
  // Output is piped for the prefix, so children would drop colors; keep them when the terminal has colors.
  const env = { ...process.env };
  if (process.stdout.isTTY && env.FORCE_COLOR === undefined && env.NO_COLOR === undefined) env.FORCE_COLOR = '1';

  let exitCode;
  let stoppedByUser = false;
  let browserOpened = false;
  let webUrl;
  const started = new Set();
  const ready = new Set();
  const running = new Set();

  const stopAll = () => {
    for (const child of running) stopTree(child);
  };

  const startApp = (index) => {
    const [app, script] = apps[index];
    if (stoppedByUser || exitCode !== undefined || started.has(app)) return;
    started.add(app);
    console.log(`[run-apps] ${manager} run ${script} in apps/${app}`);
    const child = spawn(command, runArgs(script), {
      cwd: join(root, 'apps', app),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    running.add(child);
    const readyTimer = setTimeout(() => {
      if (stoppedByUser || exitCode !== undefined) return;
      exitCode = 1;
      console.error(`[run-apps] apps/${app} did not become ready within ${startupTimeoutMs} ms. Stopping startup.`);
      stopAll();
    }, startupTimeoutMs);

    const watchLine = (line) => {
      if (stoppedByUser || exitCode !== undefined || child.exitCode !== null || child.signalCode !== null) return;
      const text = stripVTControlCharacters(line);
      if (app === 'web') webUrl ??= text.match(/\bLocal:\s+(\S+)/)?.[1];
      if (!ready.has(app) && readyLines[app]?.test(text)) {
        clearTimeout(readyTimer);
        ready.add(app);
        if (index + 1 < apps.length) startApp(index + 1);
        if (openBrowser && !browserOpened && ready.size === apps.length) {
          browserOpened = true;
          openInBrowser(webUrl);
        }
      }
    };

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      running.delete(child);
      if (exitCode === undefined) {
        exitCode = stoppedByUser ? 0 : (code || 1);
        const suffix = running.size > 0 ? '; stopping the other app.' : '.';
        if (!stoppedByUser) console.error(`[run-apps] apps/${app} stopped (exit code ${code})${suffix}`);
        stopAll();
      }
      if (running.size === 0) process.exit(exitCode);
    };

    prefixLines(child.stdout, process.stdout, `[${app}]`, watchLine);
    prefixLines(child.stderr, process.stderr, `[${app}]`);

    child.once('error', (error) => {
      console.error(`[run-apps] apps/${app}: ${error.message}`);
      if (child.pid === undefined) finish(1);
    });
    // An app that exits right after its ready line must not get a browser tab: its output can still
    // arrive between 'exit' and 'close'.
    child.once('exit', () => {
      clearTimeout(readyTimer);
      browserOpened = true;
    });
    child.once('close', (code) => finish(code));
  };

  startApp(0);

  // Ctrl+C, closing the window or a kill: stop all running apps so neither keeps its port.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(signal, () => {
      stoppedByUser = true;
      stopAll();
    });
  }
}

function prefixLines(stream, target, label, onLine) {
  createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => {
    target.write(`${label} ${line}\n`);
    onLine?.(line);
  });
}

// Opens only the loopback http URL that Next.js printed, without a shell.
function openInBrowser(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    url = undefined;
  }
  if (url?.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    console.log('[run-apps] Both apps are ready; open the web UI in your browser.');
    return;
  }
  const [opener, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [url.href]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url.href]];
  console.log(`[run-apps] Opening ${url.href} in your browser (set PKGSTEWARD_NO_BROWSER=1 to skip this).`);
  const child = spawn(opener, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => console.log(`[run-apps] Could not open a browser; open ${url.href} yourself.`));
  child.unref();
}

// On Windows the package manager wrapper starts the real server as a child process; kill the whole tree.
function stopTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}
