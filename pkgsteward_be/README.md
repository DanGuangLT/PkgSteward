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
| `SCAN_TIMEOUT_MS` | (empty) | No time limit; set milliseconds (minimum `1000`) to stop a scan after that long |
| `PKGSTEWARD_DATA_DIR` | `PkgStewardLog` | Folder for runtime data (logs, cache, `settings.json`): an absolute path, or a path relative to the project folder. The default is a `PkgStewardLog` folder inside the project folder |
| `NPM_COMMAND_TIMEOUT_MS` | (empty) | No time limit; set milliseconds (minimum `1000`) to stop an npm / pnpm / Yarn command after that long |

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
  `package-lock.json`), `hasLockfile`, `lastActivityAt` and its `node_modules` folder. `sizeBytes` and
  `sizeMeasuredAt` come from completed DiskUsage measurements, or are `null` when no measurement is cached.
- Skipped folders: `node_modules`, `dist`, folders whose name starts with `.`, `AppData`, protected system
  folders, and symbolic links / junctions inside the scan roots. Only `package.json` files are read.
- The latest result is kept in memory and in `cache/last-scan.json` inside the data folder, and is loaded
  again on startup. It is dropped when `SCAN_ROOT_PATHS` or `MAX_SCAN_DEPTH` changes. Results are not paginated.

## Disk usage API

Disk usage is a read-only background measurement. It uses **`unique-apparent`** bytes: regular-file sizes,
counting each `(device, inode)` once per measurement. Directory and link metadata are not counted. This is
neither allocated disk space nor the space that deleting a folder would reclaim. Shared hardlinks may appear
in several breakdown rows, so adding row sizes does not necessarily equal the root total.

| Endpoint                                | Result                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/disk-usage`               | JSON `{ "path": "D:\\Projects\\app", "view": "directory", "force": false }`; `202` with `{ jobId, status }`, including cache hits |
| `GET /api/v1/disk-usage/:jobId`         | `200` with the current snapshot; not rate limited, logged at debug level, `Cache-Control: no-store`                               |
| `POST /api/v1/disk-usage/:jobId/cancel` | No body; `200` with the cancelled snapshot, or the unchanged terminal snapshot on repeated calls                                  |

Responses use the standard `{ statusCode, message, code, data, timestamp, path }` envelope. `path` must be a
nonempty absolute directory path of at most 32,768 characters, allowed by `SCAN_ROOT_PATHS` and the protected
path rules. Job IDs are UUID v4. `view` defaults to `directory`; `force` defaults to `false` and must be a JSON
boolean. Extra fields and string booleans such as `"false"` are rejected.

- **Views:** `directory` lists one level of files, directories and links. `packages` requires a path named
  `node_modules` and lists direct and scoped packages, grouping aliases that have the same canonical target.
  Internal package junctions can be attributed to their target; links escaping the measured root are excluded.
  The root total includes the physical `.pnpm` tree and `.bin`, even though these are not package rows. The
  breakdown does not represent every transitive dependency. Expand a directory by starting a separate job for it.
- **Jobs:** only one measurement runs at a time. Starting the same canonical path and view returns that job;
  another target returns `409 CONFLICT` with `details: { jobId, path }` for the running job. There is **no default
  timeout**. Cancel explicitly when needed; shutdown also cancels running work. Status is `running`, `completed`,
  `cancelled` or `failed`; `timed_out` is reserved in the response contract and is not generated by this module.
- **Snapshots:** pending or excluded sizes are `null`; an empty measured directory is `0`. During measurement,
  totals are lower bounds. Inspect `partial`, `stopReason`, row `state`/`reason`, and progress counters before
  treating a result as complete. A failed job reports `failureCode` as `NOT_FOUND`, `FORBIDDEN` or
  `INTERNAL_SERVER_ERROR`.
- **Cache:** RAM only, LRU of 64 completed, nonpartial results, keyed by canonical path and view, with no TTL.
  Reuse checks the root modification time. Cache hits get a new job ID and preserve the original `measuredAt`.
  `force: true` clears the entire size cache and measures again. Restarting the backend empties this cache.
  A deep file change may not change the root timestamp, so a cached result can remain stale until forced.
- **Limits:** at most 8 metadata I/O operations run concurrently. Responses contain at most 2,000 rows; larger
  results retain the largest rows, report `partial: true` / `row_limit`, and still measure the full root. Identity
  tracking is limited to 2,000,000 memberships, storing identities only for files with multiple hardlinks.
  Exceeding this limit yields `identity_limit`. Byte totals use bigint internally; exceeding JavaScript's safe
  integer range yields `numeric_limit`. Errors in child entries can also produce partial results.
- **Scan results:** `GET /api/v1/scans/latest` fills project `nodeModules.sizeBytes` / `sizeMeasuredAt` and orphan
  `sizeBytes` / `sizeMeasuredAt` from the size cache, without filesystem I/O or starting measurements. An absent
  `node_modules` keeps both fields `null`. The timestamp is the original measurement time, not the scan time.
  Scanning and `last-scan.json` retain null sizes; enriched responses are never saved back. Schema-1 scan cache
  files without `sizeMeasuredAt` still load and the API supplies null timestamps when unmeasured. Scan summaries
  do not stat paths again and may show stale measurements; they must not be used to predict reclaimable space.

Error responses include `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`,
`429 RATE_LIMITED` for start/cancel, and `503 SERVICE_UNAVAILABLE` during shutdown. A traversal failure after
start is reported in the polled job rather than changing the already returned `202` response.

The optional Windows hardlink/junction tests use a pre-existing read-only fixture under
`PKGSTEWARD_REAL_FS_TEST_DIR`; they are skipped when that variable is absent or the platform is not Windows.

## Documentation

- Project overview and setup: [`README.md`](../README.md)
- Contributing guide: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
