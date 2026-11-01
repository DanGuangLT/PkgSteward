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

The frontend has its own `PORT` (default `24680`, integer `1`–`65535`) and `HOST` (default `127.0.0.1`,
only `127.0.0.1`, `localhost` or `::1`), set in `pkgsteward_fe/.env.local` or `pkgsteward_fe/.env`.
For each frontend variable, the first nonempty value wins: real environment → `.env.local` → `.env` → default.
When changing the frontend address, update this backend's `LIST_ORIGIN_CORS` to match the origin used in the
browser (for example, `http://localhost:24680`). When changing this backend's `PORT` or `HOST`, update the
frontend's `API_BASE_URL` (default `http://127.0.0.1:24681/api/v1`) to match.

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
boolean. Extra fields, `null` for `view` or `force`, and string booleans such as `"false"` are rejected.

- **Views:** `directory` lists one level of files, directories and links. `packages` requires a path named
  `node_modules` and lists direct and scoped packages, grouping aliases that have the same canonical target.
  Internal package junctions can be attributed to their target; links escaping the measured root are excluded
  as rows but do not make the result partial, because their targets are outside the measured tree.
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

## File operations API

File operations delete `node_modules`, build caches, project content or whole projects found by the latest scan.
Nothing is deleted without two steps: a **preview** that reports what would happen, then an **execute** that the
caller confirms for a selection of that preview. Both run in the background and are polled.

| Endpoint | Result |
|---|---|
| `GET /api/v1/file-ops/tree?path=` | One directory level of a scanned project, at most 2,000 entries (`truncated` when cut) |
| `POST /api/v1/file-ops/cleanup/preview` | Optional `{ includeKinds, olderThanDays, minSizeBytes, projectPaths }`; `202` with `{ previewId, status }` |
| `POST /api/v1/file-ops/delete/preview` | `{ paths }`, 1 to 1,000 paths of at most 32,767 characters, in a request body of at most 10 MB; `202` with `{ previewId, status }` |
| `GET /api/v1/file-ops/previews/:previewId` | Targets as they are measured, with risk; not rate limited, `Cache-Control: no-store` |
| `POST /api/v1/file-ops/previews/:previewId/cancel` | Stops measuring; targets already measured stay selectable |
| `POST /api/v1/file-ops/previews/:previewId/summary` | `{ paths }`; `200` with the risk, `confirmText` and totals of that selection |
| `POST /api/v1/file-ops/delete/execute` | `{ previewId, paths, confirm: true, acknowledgedRisks?, confirmText? }`; `202` with `{ operationId, status }` |
| `GET /api/v1/file-ops/operations/active` | The running operation, or `data: null` when idle, so a reloaded page can find it again; not rate limited, `Cache-Control: no-store` |
| `GET /api/v1/file-ops/operations/:operationId` | Per-target results; not rate limited, `Cache-Control: no-store` |
| `POST /api/v1/file-ops/operations/:operationId/cancel` | Stops before the next deletion starts; deleted targets stay deleted |

- **Deletion method:** the server decides from the target kind. `node_modules` and build caches are deleted
  permanently. A whole project or project content goes to the Windows Recycle Bin and is never deleted permanently
  as a fallback. If it cannot be recycled, the target reports an error and stays in place. A build cache folder that
  holds a scanned project counts as project content, so it is recycled and cleanup previews leave it out.
- **Size numbers:** `reclaimableBytes` estimates the space a permanent deletion frees: files whose hardlinks are all
  inside the target. `sharedBytes` is still used by hardlinks elsewhere, such as the pnpm store. Recycling frees no
  space until the bin is emptied: an operation result reports `reclaimableBytes: null` for it, and summary totals add
  its reclaimable estimate to `recycleBytes` instead.
- **Confirmation:** `confirm` must be the JSON boolean `true`. Medium and high risk also require every risk code in
  `acknowledgedRisks`, and high risk requires the exact `confirmText` from the summary: the folder name of a single
  project, otherwise `DELETE <count>`. The server recalculates risk at execute time and ignores values from the client.
- **Execute checks:** targets are checked again before starting and once more immediately before each deletion. The
  request fails with `409` and deletes nothing on `CONFLICT` (another scan, measurement, preview or operation is
  active), `SCAN_CHANGED` (a newer scan exists), `RISK_CHANGED` (a target's risk increased) or `TARGET_CHANGED`
  (a target vanished, was replaced, or no longer classifies as in the preview); `details.paths` lists the targets
  involved for the last two. Preview again in these cases. A body over 10 MB returns `413 PAYLOAD_TOO_LARGE`.
- **Results:** targets run one at a time in preview order, with no retries. Each result has a `status` (`success`,
  `failed`, `not_started`) and, on failure, an `errorCode` such as `FILE_IN_USE`, `ACCESS_DENIED`, `TARGET_GONE`,
  `TARGET_CHANGED`, `PATH_TOO_LONG` or a `RECYCLE_*` code. `mayBePartial` means a failed permanent deletion may
  have removed part of the target. One failed target does not stop the others, and the operation still ends
  `completed`, so read each result. An operation ends `cancelled` when targets were skipped by a cancel, and `failed`
  when an audit write or an unexpected error stopped it.
- **Replay:** a preview can be executed once. Sending the same paths again returns the same operation, so a lost
  response can be retried safely. Other paths return `409 CONFLICT`.
- **Audit log:** an intent record is written before anything is deleted, and a result record for each target, to
  `logs/dangerous-operations.jsonl` in the data folder. If the intent cannot be written, execute fails with `500`
  and nothing is deleted. If a result cannot be written, the remaining targets are skipped as `AUDIT_WRITE_FAILED`.
- **Limits:** previews and operations live in memory, and the 16 most recent finished ones are kept. They are lost
  on restart, so a preview must be repeated. Risk checks describe the moment they ran: a process may start, or a
  file may change, between the last check and the deletion. Process detection only sees what Windows reports.

The optional deletion tests in `src/file-ops/file-ops.real-fs.spec.ts` delete real files, so they need both
`PKGSTEWARD_REAL_FS_TEST_DIR` and `PKGSTEWARD_DESTRUCTIVE_FS_TEST=1` on Windows. They work only inside a new UUID
folder of that directory, and leave two small `pkgsteward-test-*` folders in the Recycle Bin.

## Documentation

- Project overview and setup: [`README.md`](../README.md)
- Contributing guide: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
