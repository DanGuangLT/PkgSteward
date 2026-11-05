#!/usr/bin/env node
// Runs after `npm install`, `pnpm install` or `yarn install` at the repository root and installs
// apps/api and apps/web with that same package manager, so one command sets up both apps.
import { spawnSync } from 'node:child_process';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['apps/api', 'apps/web'];

// Every supported package manager sets these for lifecycle scripts:
// npm_config_user_agent = "<name>/<version> ..." and npm_execpath = the CLI file that is running.
const manager = (process.env.npm_config_user_agent ?? '').split('/')[0];
const cli = process.env.npm_execpath;
if (!['npm', 'pnpm', 'yarn'].includes(manager) || !cli) {
  console.error('[install-apps] Run "npm install", "pnpm install" or "yarn install" at the repository root.');
  process.exit(1);
}

// Call the same CLI without a shell: a JavaScript entry runs on the current Node binary.
const isScript = ['.js', '.cjs', '.mjs'].includes(extname(cli).toLowerCase());
const command = isScript ? process.execPath : cli;
const args = isScript ? [cli, 'install'] : ['install'];

for (const app of apps) {
  console.log(`\n[install-apps] ${manager} install in ${app}`);
  const result = spawnSync(command, args, { cwd: join(root, app), stdio: 'inherit' });
  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : ` (exit code ${result.status})`;
    console.error(`[install-apps] ${manager} install failed in ${app}${reason}`);
    process.exit(result.status || 1);
  }
}
