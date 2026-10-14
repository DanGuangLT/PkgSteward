# Manager NPM

**A local web app to scan, analyze and manage the Node.js / npm projects on your Windows machine.**

[![CI](https://github.com/LienThuan04/Manager-NPM/actions/workflows/ci.yml/badge.svg)](https://github.com/LienThuan04/Manager-NPM/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English · [Tiếng Việt](README.vi.md)

> [!WARNING]
> **Early development.** The backend and frontend foundations are in place, but the feature modules
> (scanning, analysis, cleanup, version management) are **planned** and not implemented yet.
> See [Roadmap](#roadmap).

## What it is

Manager NPM runs entirely on your own machine: a NestJS API (port `8080`) and a Next.js UI (port `3000`).
It is meant to answer questions like *"which projects do I have, what do they depend on, what is outdated,
how much disk do their `node_modules` take?"* and to perform common chores (install/update packages, delete
`node_modules`, switch package manager or Node.js versions) safely.

- **Local and single-user by design:** no accounts, no authentication, no database. Data is read from the
  filesystem at the time of each request.
- **Safety first:** every destructive or machine-wide action goes through a *preview → confirm* flow.

## Status

| Area | Status |
|---|---|
| Backend foundation: NestJS 11, env validation, global exception filter, response/logging interceptors, pagination helpers, Swagger, rate limiting, tests | ✅ Done |
| Frontend foundation: Next.js 16 + React 19, Tailwind CSS v4, shadcn/ui components, light/dark/system theme, i18n (English/Vietnamese), app shell | ✅ Done |
| Frontend design-system showcase page (`/design-system`) | 🚧 In progress |
| Feature modules (see Roadmap) | 📋 Planned |

## Roadmap

| # | Module | What it will do | Safety |
|---|---|---|---|
| 4.1 | Scanner | Find Node.js projects (`package.json`) under the configured root folders | Read-only |
| 4.2 | Projects | Analyze one project: dependencies, outdated packages, vulnerabilities | Read-only |
| 4.3 | npm runner | Run `install` / `update` / `uninstall` / scripts inside a project, with streamed output | Scoped to the project |
| 4.4 | File operations | Folder tree with checkboxes; delete `node_modules`, files, folders or a whole project | Preview → confirm |
| 4.5 | Disk usage | Folder sizes and per-package breakdown of `node_modules` | Read-only, cached |
| 4.6 | Global packages | List, update and remove global packages (npm / pnpm / Yarn) | Preview → confirm |
| 4.7 | Package manager versions | Manage npm / pnpm / Yarn versions per project or globally (Corepack) | Preview → confirm |
| 4.8 | Node.js versions | Switch the active Node.js version through nvm-windows | Preview → confirm (machine-wide) |

All modules are **planned**.

## Safety model

These rules are part of the design. Every module that changes files or the environment must follow them:

- **Preview → confirm:** the module exposes a `preview` endpoint that lists exactly what will happen and an
  `execute` endpoint that requires explicit confirmation. The UI always shows the preview first.
- **Path allowlist:** every path coming from the client is resolved (including symlinks / junctions) and must be
  inside `SCAN_ROOT_PATHS`.
- **No shell string building:** external commands run through `execa` with argument arrays and a timeout.
- **Local only:** the API has no authentication by design. Keep `HOST=localhost`; do not expose it to a network.

## Requirements

- **OS:** Windows 11 is the primary target. Development also works on other systems, but some planned features
  (nvm-windows integration) are Windows-only.
- **Node.js 24** (see [`.nvmrc`](.nvmrc))
- **pnpm 11** (the only supported package manager)

## Quick start

```bash
git clone https://github.com/LienThuan04/Manager-NPM.git
cd Manager-NPM

# Backend: http://localhost:8080/api/v1 (Swagger: http://localhost:8080/swagger)
cd manager_npm_be
pnpm install
cp .env.example .env      # then set SCAN_ROOT_PATHS
pnpm dev

# Frontend: http://localhost:3000 (in a second terminal)
cd manager_npm_fe
pnpm install
pnpm dev
```

The two apps are independent pnpm projects, each with its own lockfile. There is no root `package.json`.

### Backend configuration

Copy `manager_npm_be/.env.example` to `.env`. Main variables:

| Variable | Default | Purpose |
|---|---|---|
| `MODE` | `development` | `development` enables Swagger |
| `HOST`, `PORT` | `localhost`, `8080` | Listen address |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | URL prefix, e.g. `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:3000` | Frontend origin allowed by CORS |
| `SCAN_ROOT_PATHS` | *(empty)* | Comma-separated root folders to scan; also the path allowlist |
| `MAX_SCAN_DEPTH` | `4` | Maximum folder depth when scanning |
| `NPM_COMMAND_TIMEOUT_MS` | `120000` | Timeout for npm / pnpm / Yarn commands |

## Scripts

| App | Command | What it does |
|---|---|---|
| Backend | `pnpm dev` | Start with watch mode |
| | `pnpm lint` | ESLint (auto-fix) |
| | `pnpm build` | Compile to `dist/` |
| | `pnpm test` / `pnpm test:e2e` | Unit / end-to-end tests (Jest) |
| Frontend | `pnpm dev` | Start Next.js dev server |
| | `pnpm lint` | ESLint |
| | `pnpm build` | Production build |
| | `pnpm theme:check` | Check WCAG AA contrast of the theme tokens |
| | `pnpm i18n:check` | Compare each locale's keys with the default locale (`vi`): extra keys fail, missing keys only warn |

## Project structure

```
manager_npm_be/        NestJS API (src/common, src/config, src/core; feature modules planned)
manager_npm_fe/        Next.js UI (app/, components/, i18n/, messages/, styles/, lib/)
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

- Bug reports and feature requests: [GitHub Issues](https://github.com/LienThuan04/Manager-NPM/issues)
- Security issues: **do not open a public issue**, see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © 2026 LianHarman (LienThuan04)

## Trademarks

Manager NPM is an independent project. It is not affiliated with, endorsed by, or sponsored by npm, Inc. / GitHub,
the OpenJS Foundation (Node.js), the pnpm or Yarn projects, Vercel (Next.js) or Pinterest, Inc. Product names are
used only to describe compatibility. The frontend's default theme is inspired by Pinterest's public design language;
it does not use Pinterest's logo or fonts.
