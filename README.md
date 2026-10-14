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
- **Safety first:** every destructive or machine-wide action goes through a *preview → confirm* flow.

## Requirements

- Windows 11
- Node.js 24 (see [`.nvmrc`](.nvmrc))
- pnpm 11

## Getting started

### 1. Install

```bash
git clone https://github.com/LienThuan04/PkgSteward.git
cd PkgSteward
cd pkgsteward_be && pnpm install && cd ..
cd pkgsteward_fe && pnpm install && cd ..
```

### 2. Configure

Copy `pkgsteward_be/.env.example` to `pkgsteward_be/.env` and set `SCAN_ROOT_PATHS`. Main variables:

| Variable | Default | Purpose |
|---|---|---|
| `MODE` | `development` | `development` enables Swagger |
| `HOST`, `PORT` | `localhost`, `24681` | Listen address |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | URL prefix, e.g. `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:24680` | Frontend origin allowed by CORS |
| `SCAN_ROOT_PATHS` | *(empty)* | Comma-separated root folders to scan, or `*` for every local fixed drive; also the path allowlist (system folders are always excluded) |
| `MAX_SCAN_DEPTH` | `4` | Maximum folder depth below each scan root (below each drive root for `*`) |
| `NPM_COMMAND_TIMEOUT_MS` | `360000` | Timeout for npm / pnpm / Yarn commands |

> [!IMPORTANT]
> The API has no authentication by design. Keep `HOST=localhost` and do not expose it to a network.

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
pkgsteward_be/     Backend API (NestJS 11)
pkgsteward_fe/     Web UI (Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, next-intl)
start-dev.bat      Run both apps in development mode
start-prod.bat     Build and run both apps in production mode
```

The two apps are independent pnpm projects, each with its own lockfile. There is no root `package.json`.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

- Bug reports and feature requests: [GitHub Issues](https://github.com/LienThuan04/PkgSteward/issues)
- Security issues: **do not open a public issue**, see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © 2026 LianHarman (LienThuan04)

## Trademarks

PkgSteward is an independent project. It is not affiliated with, endorsed by, or sponsored by npm, Inc. / GitHub,
the OpenJS Foundation (Node.js), the pnpm or Yarn projects, Vercel (Next.js) or Pinterest, Inc. Product names are
used only to describe compatibility. The frontend's default theme is inspired by Pinterest's public design language;
it does not use Pinterest's logo or fonts.
