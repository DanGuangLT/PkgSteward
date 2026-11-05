# PkgSteward

**A local web app to scan, analyze and manage the Node.js / npm projects on your Windows machine.**

[![CI](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml/badge.svg)](https://github.com/LienThuan04/PkgSteward/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English · [Tiếng Việt](README.vi.md)

## Overview

PkgSteward runs entirely on your own machine: a NestJS API and a Next.js web UI. It is meant to answer questions like
*"which projects do I have, what do they depend on, what is outdated, how much disk do their `node_modules` take?"*
and to perform common chores (install/update packages, delete `node_modules`, switch package manager or Node.js
versions) safely.

- **Local and single-user by design:** no accounts, no authentication, no database. Data is read from the
  filesystem at the time of each request.
- **Safety first:** file deletions and machine-wide changes go through a *preview → confirm* flow; project
  commands (below) start in one click next to a permanent trust notice.
- **Project commands:** run install/update/uninstall or a declared script from project details with npm 11 or
  pnpm 11, live logs and Stop; workspace members support scripts only. Run starts in one click without confirmation.

> [!WARNING]
> Only run projects you trust. Commands execute project/lifecycle code and configuration (`.npmrc`, pnpmfile,
> plugins) with your user rights and no sandbox; they may use the network, shared stores and files outside the
> project. Logs may reveal secrets. There is no rollback; stopped/failed runs may leave partial changes. Stop
> may miss processes that escape the tracked tree, and a junction swap at launch is not fully prevented.
> See [Command runner API](apps/api/README.md#command-runner-api) for tool/config limits and cleanup behavior.

## Requirements

- Windows 11
- Node.js 24 (see [`.nvmrc`](.nvmrc))
- pnpm 11 (recommended), npm or Yarn 1 to install; `start-dev.bat` and `start-prod.bat` need pnpm

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
| `PKGSTEWARD_DATA_DIR` | `PkgStewardLog` | Folder for runtime data (logs, cache, `settings.json`): an absolute path, or a path relative to the project folder. The default is a `PkgStewardLog` folder inside the project folder |
| `NPM_COMMAND_TIMEOUT_MS` | (empty) | No time limit; set milliseconds (minimum `1000`) to stop an npm / pnpm / Yarn command after that long |

Values in settings.json inside the data folder override environment variables.

Frontend variables go in `apps/web/.env.local` or `apps/web/.env` (copy the frontend's `.env.example`):

| Variable | Default when empty or unset | Purpose |
|---|---|---|
| `PORT` | `24680` | Frontend listen port; decimal integer from `1` to `65535` |
| `HOST` | `127.0.0.1` | Frontend listen host; only `127.0.0.1`, `localhost` or `::1` |
| `API_BASE_URL` | `http://127.0.0.1:24681/api/v1` | Server-only backend URL; must match the backend address |

For frontend `PORT`/`HOST`, the first nonempty value wins: real environment → `.env.local` → `.env` → default.
Whitespace-only values count as empty; invalid values stop startup. When changing the frontend `PORT` or `HOST`,
update the backend's `LIST_ORIGIN_CORS` to match the origin used in the browser (for example,
`http://localhost:24680`). When changing the backend `PORT` or `HOST`, update the frontend's `API_BASE_URL`.

> [!IMPORTANT]
> The API has no authentication by design. Keep `HOST` on a loopback address (default `127.0.0.1`) and do not expose it to a network.

### 3. Run

Double-click a script in the repository root, or run it from a terminal:

| Script | What it does |
|---|---|
| `start-dev.bat` | Starts the backend and the frontend in development mode (watch / hot reload) |
| `start-prod.bat` | Builds both apps, then starts them in production mode (`MODE=production`, Swagger off) |

Each app opens in its own window; press `Ctrl+C` or close the window to stop it. If `node_modules` is missing, the
scripts install dependencies first. The commands they run are set at the top of each file.

| | URL |
|---|---|
| Web UI | http://localhost:24680 |
| API | http://localhost:24681/api/v1 |
| Swagger (development only) | http://localhost:24681/swagger |

To run an app on its own, use the scripts below inside its folder.

## Scripts

| App | Command | What it does |
|---|---|---|
| Backend | `pnpm dev` | Start with watch mode |
| | `pnpm build` / `pnpm start:prod` | Compile to `dist/` / run the compiled build |
| | `pnpm lint` | ESLint (auto-fix) |
| | `pnpm test` / `pnpm test:e2e` | Unit / end-to-end tests (Jest) |
| Frontend | `pnpm dev` | Start the Next.js dev server |
| | `pnpm build` / `pnpm start` | Production build / serve it |
| | `pnpm lint` | ESLint |
| | `pnpm theme:check` | Check WCAG AA contrast of the theme tokens |
| | `pnpm i18n:check` | Compare each locale's keys with the default locale (`vi`): extra keys fail, missing keys only warn |

## Project structure

```
apps/api/          Backend API (NestJS 11)
apps/web/          Web UI (Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, next-intl)
start-dev.bat      Run both apps in development mode
start-prod.bat     Build and run both apps in production mode
```

The two apps are independent pnpm projects, each with its own lockfile. There is no root `package.json`.

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
the OpenJS Foundation (Node.js), the pnpm or Yarn projects, Vercel (Next.js) or Pinterest, Inc. Product names are
used only to describe compatibility. The frontend's default theme is inspired by Pinterest's public design language;
it does not use Pinterest's logo or fonts.
