<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/logo-wordmark.svg">
    <img src=".github/assets/logo-wordmark.svg" alt="PkgSteward logo" width="320">
  </picture>
</p>

# PkgSteward

**A local web app to scan, analyze and manage the Node.js / npm projects on your Windows machine.**

[![CI](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml/badge.svg)](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English · [Tiếng Việt](README.vi.md)

## Overview

PkgSteward runs entirely on your own machine: a NestJS API and a Next.js web UI. It is meant to answer questions like
*"which projects do I have, what do they depend on, what is outdated, how much disk do their `node_modules` take?"*
and to perform common chores (install/update packages, delete `node_modules`, pin a project's package
manager version) safely.

- **Local and single-user by design:** no accounts, no authentication, no database. Data is read from the
  filesystem at the time of each request.
- **Safety first:** file deletions and machine-wide changes go through a *preview → confirm* flow; project
  commands (below) start in one click next to a permanent trust notice.
- **Project commands:** run install/update/uninstall or a declared script from project details with npm 10–12 or
  pnpm 10–12 in a dedicated native Windows **CMD** or **PowerShell** console window (`cmd` default, stays open after
  the initial command finishes until closed or **Stop** is requested; workspace members support scripts only). Run
  starts in one click without confirmation, and any unresolved previous console session triggers a **recovery hold**
  requiring explicit confirmation to clear and stop remaining processes.

> [!WARNING]
> Only run projects you trust. Commands execute project/lifecycle code and configuration (`.npmrc`, pnpmfile,
> plugins) with your user rights and no sandbox; they may use the network, shared stores and files outside the
> project. Interactive output stays in the opened Windows console window. There is no rollback; stopped/failed runs may leave partial changes. Stop
> may miss processes that escape the tracked tree, and a junction swap at launch is not fully prevented.
> See [Command runner API](apps/api/README.md#command-runner-api) for tool/config limits and cleanup behavior.

## Settings

Open **Settings** from the navigation bar to change themes, layout, wallpapers, scan roots, timeouts, and display preferences. Supported runtime changes take effect without restarting; server settings are marked when a restart is required. Use **Advanced → Backup & Reset** to export, import, or reset settings. Changes to runtime and server settings use preview and confirmation.

See the [Settings guide](apps/web/README.md#settings) for appearance and plugins.

## Node Runtime Inspector

Open **Node Runtime** from the navigation bar to see which Node.js version is running PkgSteward's API and how it
compares with the requirements of projects from the latest scan. For one project, go to **Projects → View details**
and find the **Project Node.js compatibility** card.

PkgSteward reads declarations such as `.nvmrc`, `.node-version` and `engines.node` in `package.json`.
**Compatible** means the active version satisfies the requirement. **Version mismatch** means it falls outside the
requirement. **Unknown range** means PkgSteward could not resolve the declaration, while **Undeclared** means the project
has no Node.js version declaration that the inspector reads.

The inspector is read-only. When a suggested command is available, **Copy** puts it on the clipboard so you can
review and run it yourself in a terminal.

## Global packages

Manage global packages with npm 10/11/12, pnpm 10/11/12 or Yarn Classic (1.x) through **preview → confirm** (Yarn 2+ removed `yarn global` upstream and is refused).
pnpm globals must already be set up: run `pnpm setup` in a terminal, ensure `PNPM_HOME` (or your configured
global bin directory) is on PATH, open a new terminal and restart PkgSteward. Yarn Classic globals require
the Yarn global bin folder on PATH or an explicit prefix in Yarn configuration (`PREFIX` / `.yarnrc` `prefix`);
otherwise PkgSteward reports `YARN_GLOBAL_NOT_CONFIGURED`.

pnpm 10 and Yarn Classic (1.x) keep all global packages in one shared project. Changing or removing one reruns
the manager on that project.
The preview lists the other packages; afterwards, PkgSteward verifies they are unchanged. If verification fails,
the result could not be verified: refresh the inventory and inspect the packages before another action.
There is no automatic retry or undo. `link:`, file, git, tarball and alias installs are listed read-only.
Old package versions may stay on disk until pnpm prunes them. Only change packages you trust: lifecycle and
transitive code can affect the whole machine with your user privileges, without a sandbox.
See [Global packages](apps/web/README.md#global-packages) for the full workflow and limits.

## Requirements

- Windows 11
- Node.js 22.18 or newer (tested on Node 22 and 24; development uses Node 24, see [`.nvmrc`](.nvmrc)). Older Node prints a warning at startup and may fail to run.
- To install PkgSteward: pnpm 11 (recommended), pnpm 10, npm, or Yarn 1. Project commands and global package management also support pnpm 12 within their documented limits.

## Getting started

### 1. Install

```bash
git clone https://github.com/LienThuan04/PkgSteward.git
cd PkgSteward

# Run one of these at the repository root; it installs both apps/api and apps/web for each package manager you use (run only one of the following three commands):
pnpm install
npm install
yarn install
```

The root install runs the same package manager inside `apps/api` and `apps/web`. Only pnpm reads the
committed `pnpm-lock.yaml` files, which pin the tested versions. npm and Yarn resolve the newest versions
allowed by each `package.json`, and the lockfiles they create are not committed.

If `npm install` or `yarn install` cannot find a matching version (for example, npm reports `ETARGET`)
or the package tarball download returns HTTP 404, check the exact package, version, and registry in the
error. Run `npm view "PACKAGE@VERSION" dist.tarball --registry "REGISTRY_URL"` with those values. The
version can appear in the registry before the tarball is available. Retry the same install once the
registry serves the file.

If you can use the tested dependency versions, run `pnpm install` at the repository root with pnpm 11.
It uses the committed lockfiles for both apps and still needs access to the pinned tarballs.

For a fresh install with Yarn Classic (`1.22.22`), use a current Node.js 24 release so newly resolved
dependencies can satisfy their Node.js requirements. Run `yarn install` at the root, then `yarn build` and
`yarn start`, or use `yarn dev` for development.

Use `yarn install --offline` at the repository root to install both apps using Yarn's local cache.

Run the test suites from the repository root after installing with Yarn:

```bash
yarn --cwd apps/web test                  # frontend unit tests
yarn --cwd apps/api test --runInBand       # backend unit tests
yarn --cwd apps/api test:e2e --runInBand   # backend HTTP end-to-end tests
```

PkgSteward detects Yarn projects and reads Yarn Classic lockfiles for dependency analysis. The in-app command
runner uses npm and pnpm, and `NPM_COMMAND_TIMEOUT_MS` applies to operations started by the app.

### 2. Configure

Copy `apps/api/.env.example` to `apps/api/.env` and set `SCAN_ROOT_PATHS`. Main variables:

| Variable | Default | Purpose |
|---|---|---|
| `MODE` | `development` | `development` enables Swagger |
| `HOST`, `PORT` | `127.0.0.1`, `24681` | Listen address; `HOST` must be a loopback address (`127.0.0.1`, `localhost` or `::1`) |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | URL prefix, e.g. `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:24680` | Frontend origin allowed by CORS |
| `SCAN_ROOT_PATHS` | `*` | Comma-separated absolute root folders to scan (e.g. `D:\Projects`), or `*` (also when empty) for every local fixed drive; `*` must be used alone. Also the path allowlist (system folders are always excluded) |
| `MAX_SCAN_DEPTH` | `0` | Maximum folder depth below each scan root (below each drive root for `*`); `0` means no limit |
| `SCAN_TIMEOUT_MS` | (empty) | No time limit; set milliseconds (minimum `1000`) to stop a scan after that long |
| `PKGSTEWARD_DATA_DIR` | (empty) | Folder for runtime data (logs, cache, `settings.json`): explicit absolute path (or relative in dev checkout/portable mode), else `PkgStewardLog` in a `.git` checkout or portable mode (`PORTABLE_EXECUTABLE_DIR` / `portable.flag`), else the OS user data folder (`%LOCALAPPDATA%\PkgSteward` on Windows, `~/Library/Application Support/PkgSteward` on macOS, `$XDG_DATA_HOME/PkgSteward` or `~/.local/share/PkgSteward` on Linux). Reports a clear error if the resolved folder is not writable |
| `NPM_COMMAND_TIMEOUT_MS` | (empty) | No time limit; set milliseconds (minimum `1000`) to stop an npm or pnpm command after that long |

Values in settings.json inside the data folder override environment variables.

Frontend variables go in `apps/web/.env.local` or `apps/web/.env` (copy the frontend's `.env.example`):

| Variable | Default when empty or unset | Purpose |
|---|---|---|
| `PORT` | `24680` | Frontend listen port; decimal integer from `1` to `65535` |
| `HOST` | `127.0.0.1` | Frontend listen host; only `127.0.0.1`, `localhost` or `::1` |
| `API_BASE_URL` | `http://127.0.0.1:24681/api/v1` | Server-only backend URL, including its API prefix and version |

For frontend `PORT`/`HOST`, the first nonempty value wins: real environment → `.env.local` → `.env` → default.
Whitespace-only values count as empty; invalid values stop startup. When changing the frontend `PORT` or `HOST`,
update the backend's `LIST_ORIGIN_CORS` to match the origin used in the browser (for example,
`http://localhost:24680`). Update the frontend's `API_BASE_URL` when changing the backend `HOST`, `PORT`,
`GLOBAL_PREFIX` or `VERSION`. For example, with `GLOBAL_PREFIX=steward` and `VERSION=2` on the default address,
set `API_BASE_URL=http://127.0.0.1:24681/steward/v2` in `apps/web/.env.local`.

#### Custom ports when starting both apps

Root `dev` and `start` pass the terminal's environment to both apps. A shared `PORT` can make
both try to listen on the same port. This example uses distinct ports and the default API prefix
and version.

In `apps/api/.env`, set:

```dotenv
HOST=127.0.0.1
PORT=24781
LIST_ORIGIN_CORS=http://127.0.0.1:24780
```

In `apps/web/.env.local`, set:

```dotenv
HOST=127.0.0.1
PORT=24780
API_BASE_URL=http://127.0.0.1:24781/api/v1
```

If you set `HOST` or `PORT` in the current PowerShell session, clear them before running the root
command so the apps can use their own settings:

```powershell
Remove-Item Env:HOST, Env:PORT -ErrorAction SilentlyContinue
```

Open `http://127.0.0.1:24780` to match `LIST_ORIGIN_CORS`. If the backend has saved server settings
in `settings.json`, make sure those values also match the example.

> [!IMPORTANT]
> The API has no authentication by design. Keep `HOST` on a loopback address (default `127.0.0.1`) and do not expose it to a network.

### 3. Run

Start both apps from the repository root, with the package manager you installed with:

```bash
pnpm dev        # or: npm run dev / yarn dev
```

After pulling updates, the root `dev`, `build`, and `start` commands check each app for missing declared
dependencies, including development dependencies. If a package is missing, the launcher runs `install` in
that app with the same package manager. An installation failure names the affected app and stops the command
before either app runs. Use the install step above for initial setup and to refresh versions after lockfile changes.

Both apps run in one terminal (`apps/api` starts first, then `apps/web` starts once the backend is ready; each output line starts with `[api]` or `[web]`). Press `Ctrl+C` to stop both.
If one app stops (for example, because of an invalid `.env` value), the other one is stopped too (or `apps/web` is not launched if `apps/api` fails during startup).

Root `dev` and `start` allow two minutes per app to become ready. On timeout, the command names the stalled app, stops the apps it launched, and exits with an error. Set `PKGSTEWARD_STARTUP_TIMEOUT_MS` to a positive integer in milliseconds to change the limit.

For production, set `MODE=production` in `apps/api/.env` (Swagger off), then run at the repository root:

```bash
pnpm build      # or: npm run build / yarn build (builds apps/api, then apps/web)
pnpm start      # or: npm start / yarn start (starts start:prod in apps/api, then start in apps/web)
```

`start` opens the web UI in your default browser once both apps are ready (one tab per run; `dev` never opens one).
Set `PKGSTEWARD_NO_BROWSER=1` to skip it. In PowerShell, run `$env:PKGSTEWARD_NO_BROWSER = "1"` before `pnpm start`. The setting lasts for the current shell. Clear it with `Remove-Item Env:PKGSTEWARD_NO_BROWSER` to restore automatic browser launch.

You can still run an app on its own inside its folder, for example `cd apps/api && pnpm dev`.

| | URL |
|---|---|
| Web UI | http://localhost:24680 |
| API | http://localhost:24681/api/v1 |
| Swagger (development only) | http://localhost:24681/swagger |

Root scripts run both apps; the other scripts below run inside the app's folder. With npm, use `npm run <script>`; with
Yarn, `yarn <script>`.

## Scripts

Use a current Node.js 24 release to run the backend Jest tests (`test` and `test:e2e`). The backend
runtime supports Node.js 22.18 and newer.

| App | Command | What it does |
|---|---|---|
| Root | `pnpm install` | Install both apps |
| | `pnpm dev` | Start both apps in development mode |
| | `pnpm build` / `pnpm start` | Build both apps / run both production builds |
| Backend | `pnpm dev` | Start with watch mode |
| | `pnpm build` / `pnpm start:prod` | Compile to `dist/` / run the compiled build |
| | `pnpm lint` | ESLint (auto-fix) |
| | `pnpm test` / `pnpm test:e2e` | Unit / end-to-end tests (Jest) |
| Frontend | `pnpm dev` | Start the Next.js dev server |
| | `pnpm build` / `pnpm start` | Production build / serve it |
| | `pnpm lint` | ESLint |
| | `pnpm test` | Frontend unit tests (Node.js test runner) |
| | `pnpm theme:check` | Check WCAG AA contrast of the theme tokens |
| | `pnpm i18n:check` | Compare each locale's keys with the default locale (`vi`): extra keys fail, missing keys only warn |

## Project structure

```
apps/api/          Backend API (NestJS 12)
apps/web/          Web UI (Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, next-intl)
scripts/           Repository scripts (root install and run, third-party notices)
package.json       Root scripts: install, run and build both apps
```

The two apps are independent pnpm projects, each with its own lockfile. The root `package.json` has no
dependencies; it only installs, runs and builds both apps with the package manager you call it with.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

- Bug reports and feature requests: [GitHub Issues](https://github.com/LienThuan04/PkgSteward/issues)
- Security issues: **do not open a public issue**, see [SECURITY.md](SECURITY.md)

## License

Copyright (c) 2026 LianHarman (LienThuan04). Released under the [MIT License](LICENSE).

## Third-party licenses

PkgSteward depends on open-source packages under their own licenses. Their copyrights belong to their respective
authors. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the full list with versions and licenses.
Each app also carries its own `LICENSE` file.

## Trademarks

PkgSteward is an independent project. It is not affiliated with, endorsed by, or sponsored by npm, Inc. / GitHub,
the OpenJS Foundation (Node.js), the pnpm or Yarn projects, or Vercel (Next.js). Product names are used only to
describe compatibility. The frontend uses no third-party logos or brand fonts.
