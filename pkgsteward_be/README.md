# pkgsteward_be

Backend of **PkgSteward**: a local tool to scan, analyze and manage the Node.js / npm projects on a Windows
machine. NestJS 11 + TypeScript.

- Local and single-user: **no authentication / authorization and no database** (removed when the original
  base-auth scaffold was cleaned up). Data is the state of the filesystem at the time of each request.
- API: `http://localhost:24681/api/v1`. Swagger (when `MODE=development`): `http://localhost:24681/swagger`.
- Safety rules: dangerous operations (deleting files, changing global versions, switching Node.js) use a
  `preview` → `execute` pair; every path coming from the client must be inside `SCAN_ROOT_PATHS`.

## Run

Requirements: Node 24, pnpm 11.

```bash
pnpm install
# create .env from .env.example and set SCAN_ROOT_PATHS
pnpm dev
```

| Command | What it does |
|---|---|
| `pnpm dev` | Start in watch mode (`nest start --watch`) |
| `pnpm lint` | ESLint (with `--fix`) |
| `pnpm build` | Compile to `dist/` |
| `pnpm start:prod` | Run the compiled build |
| `pnpm test` / `pnpm test:e2e` | Unit / end-to-end tests |

## Main environment variables

Full list in `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `MODE` | `development` | `development` enables Swagger |
| `HOST`, `PORT` | `127.0.0.1`, `24681` | Listen address; `HOST` must be a loopback address (`127.0.0.1`, `localhost` or `::1`) |
| `GLOBAL_PREFIX`, `VERSION` | `api`, `1` | URL prefix, e.g. `/api/v1` |
| `LIST_ORIGIN_CORS` | `http://localhost:24680` | Frontend origin allowed by CORS |
| `EXPORT_SWAGGER_API_JSON` | `true` | `true` / `false`: export `docs_API/swagger.json` inside the backend folder in development (this folder is not committed) |
| `SCAN_ROOT_PATHS` | `*` | Comma-separated absolute root folders to scan (e.g. `D:\Projects`), or `*` (also when empty) for every local fixed drive; `*` must be used alone. Also the path allowlist (system folders are always excluded) |
| `MAX_SCAN_DEPTH` | `0` | Maximum folder depth below each scan root (below each drive root for `*`); `0` means no limit |
| `SCAN_TIMEOUT_MS` | `900000` | Time limit for one scan in milliseconds (minimum `1000`) |
| `PKGSTEWARD_DATA_DIR` | `PkgStewardLog` | Folder for runtime data (logs, cache, `settings.json`): an absolute path, or a path relative to the project folder. The default is a `PkgStewardLog` folder inside the project folder |
| `NPM_COMMAND_TIMEOUT_MS` | `360000` | Timeout for npm / pnpm / Yarn commands |

Values in settings.json inside the data folder override environment variables.

## Scan API

Scanning finds every folder with a `package.json` under `SCAN_ROOT_PATHS`. A scan runs in the background:
start it, poll its progress, then read the result.

| Endpoint | Result |
|---|---|
| `POST /api/v1/scans` | `202` with `{ scanId, status }`. Only one scan runs at a time: while one is running, the same job is returned |
| `GET /api/v1/scans/:scanId` | Job status and progress (`visitedDirs`, `foundProjects`, `skippedCount`). Not rate limited, meant for polling |
| `POST /api/v1/scans/:scanId/cancel` | Cancels a running scan; a finished job is returned unchanged |
| `GET /api/v1/scans/latest` | Latest result: roots, projects and orphan `node_modules` folders. `404` until a scan has finished |

- `status` is `running`, `completed`, `cancelled`, `timed_out` or `failed`. `partial` is `true` when the scan
  did not finish normally. Only `completed` and `timed_out` scans replace the latest result.
- Each project reports its path, `name`, package manager (from the lockfile: `pnpm-lock.yaml`, `yarn.lock`,
  `package-lock.json`), `hasLockfile`, `lastActivityAt` and its `node_modules` folder. `sizeBytes` is `null`
  until disk usage is implemented.
- Skipped folders: `node_modules`, `dist`, folders whose name starts with `.`, `AppData`, protected system
  folders, and symbolic links / junctions inside the scan roots. Only `package.json` files are read.
- The latest result is kept in memory and in `cache/last-scan.json` inside the data folder, and is loaded
  again on startup. It is dropped when `SCAN_ROOT_PATHS` or `MAX_SCAN_DEPTH` changes. Results are not paginated.

## Documentation

- Project overview and setup: [`README.md`](../README.md)
- Contributing guide: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
