#!/usr/bin/env node
// Runs `dev`, `build` or `start` for apps/api and apps/web with the package manager that started the
// root script (`npm run dev`, `pnpm dev`, `yarn dev`, ...). `dev` and `start` run both apps at once in
// one terminal (output prefixed [api] / [web]); `build` builds them one after the other. `start` also
// opens the web UI in the default browser once both apps are ready.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, extname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Script to run inside each app for every root command.
const tasks = {
  dev: { parallel: true, apps: [['api', 'dev'], ['web', 'dev']] },
  build: { parallel: false, apps: [['api', 'build'], ['web', 'build']] },
  start: { parallel: true, openBrowser: true, apps: [['api', 'start:prod'], ['web', 'start']] },
};

// Log line each app prints once it accepts requests (apps/api main.ts, Next.js).
const readyLines = { api: /Application is running on:/, web: /\bReady in\b/ };

const taskName = process.argv[2];
const task = tasks[taskName];
if (!task) {
  console.error(`[run-apps] Task must be one of: ${Object.keys(tasks).join(', ')} (got ${JSON.stringify(taskName)}).`);
  process.exit(1);
}

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
const runArgs = (script) => (isScript ? [cli, 'run', script] : ['run', script]);

if (task.parallel) runParallel(task.apps, task.openBrowser === true && !process.env.PKGSTEWARD_NO_BROWSER);
else runSequential(task.apps);

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

function runParallel(apps, openBrowser) {
  // Output is piped for the prefix, so children would drop colors; keep them when the terminal has colors.
  const env = { ...process.env };
  if (process.stdout.isTTY && env.FORCE_COLOR === undefined && env.NO_COLOR === undefined) env.FORCE_COLOR = '1';

  let exitCode;
  let stoppedByUser = false;
  const running = new Set();

  const stopAll = () => {
    for (const child of running) stopTree(child);
  };

  // Apps that have not printed their ready line yet; the browser opens once, when this becomes empty.
  let waiting = openBrowser ? new Set(apps.map(([app]) => app)) : null;
  let webUrl;
  const watchLine = (app, line) => {
    if (!waiting || stoppedByUser || exitCode !== undefined) return;
    const text = stripVTControlCharacters(line);
    if (app === 'web') webUrl ??= text.match(/\bLocal:\s+(\S+)/)?.[1];
    if (readyLines[app]?.test(text)) waiting.delete(app);
    if (waiting.size === 0) {
      waiting = null;
      openInBrowser(webUrl);
    }
  };

  for (const [app, script] of apps) {
    console.log(`[run-apps] ${manager} run ${script} in apps/${app}`);
    const child = spawn(command, runArgs(script), {
      cwd: join(root, 'apps', app),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    running.add(child);
    prefixLines(child.stdout, process.stdout, `[${app}]`, (line) => watchLine(app, line));
    prefixLines(child.stderr, process.stderr, `[${app}]`);

    child.once('error', (error) => console.error(`[run-apps] apps/${app}: ${error.message}`));
    // An app that exits right after its ready line must not get a browser tab: its output can still
    // arrive between 'exit' and 'close'.
    child.once('exit', () => {
      waiting = null;
    });
    child.once('close', (code) => {
      running.delete(child);
      if (exitCode === undefined) {
        exitCode = stoppedByUser ? 0 : (code ?? 1);
        if (!stoppedByUser) console.error(`[run-apps] apps/${app} stopped (exit code ${code}); stopping the other app.`);
        stopAll();
      }
      if (running.size === 0) process.exit(exitCode);
    });
  }

  // Ctrl+C, closing the window or a kill: stop both apps so neither keeps its port.
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
