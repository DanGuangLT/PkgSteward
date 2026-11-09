# @pkgsteward/api

**Backend for PkgSteward - local manager for Node.js projects and their npm / pnpm / Yarn packages**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Backend of **PkgSteward**: a local tool to scan, analyze and manage the Node.js / npm projects on a Windows
machine. NestJS 12 + TypeScript.

- Local and single-user: **no authentication / authorization and no database** (removed when the original
  base-auth scaffold was cleaned up). Data is the state of the filesystem at the time of each request.
- API: `http://localhost:24681/api/v1`. Swagger (when `MODE=development`): `http://localhost:24681/swagger`.
- Safety rules: dangerous operations (deleting files, changing global versions) use a
  `preview` → `execute` pair; every path coming from the client must be inside `SCAN_ROOT_PATHS`.

## Requirements

Node 24, pnpm 11. Target platform: Windows 11.

## Install

Run inside `apps/api/`:

```bash
pnpm install
# create .env from .env.example and set SCAN_ROOT_PATHS
```

## Run

```bash
pnpm dev
```

## Scripts

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
only `127.0.0.1`, `localhost` or `::1`), set in `apps/web/.env.local` or `apps/web/.env`.
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

## Projects API

Project details are local reads. Online version and vulnerability checks start only on an explicit request;
opening or refreshing a detail page never starts them.

| Endpoint | Result |
|---|---|
| `GET /api/v1/projects?path=...` | `200` with manifest dependencies, inert scripts, manager/lockfile metadata, input identity, read time and a cached disk-size reference |
| `POST /api/v1/projects/analyses` | `{ path }`; `202` with `{ jobId, status }` |
| `GET /api/v1/projects/analyses/:jobId` | `200` with the current snapshot; polling bypasses throttling and logs at debug level |
| `POST /api/v1/projects/analyses/:jobId/cancel` | No body; `200` with a snapshot; repeated cancellation is idempotent |

Responses use the standard envelope. Reads, including errors, are `no-store`. Paths must be single, nonempty,
absolute strings of at most 32,768 characters, pass the path guard, and identify exactly a project in the latest
scan. Job IDs are UUID v4. Extra DTO fields are rejected. Missing projects return `404 NOT_FOUND`; projects absent
from the latest scan return `409 CONFLICT` with reason `PROJECT_NOT_SCANNED`.

- **No runtime commands:** the module reads bounded local data and uses HTTP to the fixed
  `https://registry.npmjs.org` origin. It never invokes npm, pnpm, Yarn, Corepack, project scripts or plugins, and
  never installs, updates or fixes packages. Missing package-manager executables do not prevent analysis;
  their installed versions remain unknown. Manifest `packageManager` is metadata only.
- **Disclosure and registry policy:** online checks send dependency names and versions to the public npm registry.
  When a lockfile can be read, only names it shows as coming from the public registry are sent; other dependencies
  report `UNSUPPORTED_SPEC`.
  No credentials, custom registries, redirects, project-selected URLs, user/global config or environment proxy
  configuration are used. A bounded project-level config text check for registry/authentication keys disables
  online checks with `REGISTRY_CONFIG_UNSUPPORTED`, including when those keys occur in comments. Local detail
  remains available. Offline/registry failures retain local information and any positive findings.
- **Lock support:** npm lock v2/v3 (shrinkwrap takes precedence), pnpm lock v9, and Yarn Classic v1. Yarn Berry
  and other schemas have unavailable audit coverage (`UNSUPPORTED_LOCKFILE`). Missing or mismatched local locks
  likewise prevent a complete audit; manifest-based wanted/latest checks may still work. No parent lock search,
  package resolver, dependency graph or installed-tree traversal is performed.
- **Coverage:** vulnerability checks cover every registry-sourced package entry in the selected lockfile,
  including entries for other workspaces/importers, deduplicated by name/version. A finding is direct only when
  its actual registry name is declared by the root manifest. Results describe **locked versions**, not installed
  `node_modules`, npm metavulnerabilities or promised fixes. Outdated rows compare locked versions with wanted
  and latest targets; unsupported specs and unknown versions remain visible. A deprecated version is a finding,
  and does not by itself make an otherwise fully checked outdated section partial.
- **Lifecycle:** one active analysis and one retained job, in RAM only. Same canonical-project starts coalesce;
  another project returns `409 CONFLICT` with `{ reason: 'ANALYSIS_RUNNING', jobId, path }`, preserving the lexical
  request path. A later accepted job replaces the terminal snapshot; restart or replacement makes old IDs return
  `404`. Statuses are `running`, `completed`, `cancelled`, `timed_out`, `failed`. Start/cancel retain rate limits.
- **Timeout and cancellation:** `NPM_COMMAND_TIMEOUT_MS` bounds the entire online job; empty/unset means no time
  limit. Cancellation is explicit; there is no automatic retry. Bounded synchronous parsing may finish before
  cancellation is observed. In-flight requests keep their concurrency permits until they settle.
- **Consistency:** only start checks the mutation gate, immediately before reserving the slot. Detail and poll
  do not block writes. Inputs/scan identity are rechecked once at job end; changes produce stale, partial results
  with `INPUT_CHANGED`. Every poll is a defensive snapshot with no filesystem, guard, hashing or gate work.
  `checkedAt` records historical verification, not continuous freshness; files can change afterwards. No analysis
  cache or persistence exists. Disk sizes are existing RAM-cache references only; no measurement starts here.
- **Results:** each section exposes state, checked/total counts, warnings and failure code. `null` means unknown,
  while `0` means known empty. Partial/unavailable/stale/cancelled/timed-out results retain findings and cannot
  support a clean verdict. An empty complete, current audit supports only a no-findings statement for its scope.
- **Limits:** manifest/config files 1 MiB each; lockfiles 32 MiB; 50,000 lock records; 2,000 displayed direct rows;
  10,000 audit name/version pairs; 64 MiB decoded package metadata per response; 16 MiB audit response; 2,000
  displayed advisories; up to four network requests and four file reads concurrently. Audit requests split at
  500 names or a 1 MiB body. Limits produce explicit partial/unavailable `LIMIT_EXCEEDED` results, never a
  successful empty result. Registry-wide failures stop scheduling more requests and retain completed findings.

Other errors include `400 VALIDATION_ERROR`, `403 FORBIDDEN`, start-only mutation-gate `409 CONFLICT`,
`429 RATE_LIMITED`, and normalized registry/input failure codes within accepted job snapshots. Advisory links
are clickable only for validated HTTPS GitHub/npm advisory URLs; other titles remain plain text.

## Command runner API

Run one command in a project from the latest scan: install all dependencies, install one package, update all,
update one, uninstall one, or run one script declared in `package.json`. Supported tools are **npm 11 and pnpm 11**,
verified with npm 11.17.0, pnpm 11.22.0 and Node 24.19.0. Yarn projects return `UNSUPPORTED_MANAGER`; pnpm without
a resolvable global installation returns `TOOL_NOT_FOUND`. Corepack-only or unknown installation layouts are
refused; the app never downloads or switches tools. A workspace root allows all actions; a workspace member
allows scripts only (`WORKSPACE_LEAF`). A `packageManager` pin must match the installed major
(`TOOL_VERSION_MISMATCH` otherwise); other version differences warn with `PACKAGE_MANAGER_PIN_DIFFERS`.

**Only run projects you trust.** Run executes project code, including lifecycle scripts and behavior from
`.npmrc`, pnpmfile and plugins, with your user rights and no sandbox. It may use the network, shared stores and
files outside the project. Logs may reveal secrets. There is no rollback: a stopped or failed run can leave
partial changes. Stop may miss processes that escape the tracked tree, including descendants whose intermediate
parent exits before discovery. Replacing the project folder through a junction swap at the exact moment of
launch is not fully prevented. Run starts without a preview/confirmation step.

| Endpoint | Result |
|---|---|
| `GET /api/v1/npm-runs/context?path=...` | `200` with manager/version, eligible scripts, warnings and `inputHash`; starts no process |
| `POST /api/v1/npm-runs` | `{ path, action, inputHash, requestId, package?, script? }`; `202` with `{ jobId, requestId, status }`; the retained job's `requestId` returns that same job |
| `GET /api/v1/npm-runs/latest` | `200` with the latest retained run |
| `GET /api/v1/npm-runs/:id` | `200` with status, phase, actual exit code, failure/warnings and cleanup state; no filesystem work |
| `GET /api/v1/npm-runs/:id/logs?cursor=...` | `200` with a bounded output page and `nextCursor`; cursor defaults to `0` |
| `POST /api/v1/npm-runs/:id/cancel` | No body; `202` while stopping or the lock is held, otherwise `200`; also retries unfinished cleanup without restarting the command |

Responses use the standard envelope; successful responses send `Cache-Control: no-store`. Status/latest/log polling bypasses throttling;
start/cancel remain rate limited. Paths must be fully qualified Windows paths, at most 32,767 characters, pass
the path guard and identify a currently scanned project. IDs and `requestId` are UUID v4; `inputHash` is the
64-character lowercase hexadecimal value from context. Extra fields are rejected. `package` is required only
for the three single-package actions; `script` only for `script`, and both must be omitted otherwise. A cursor
is a nonnegative safe integer. Errors include `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 NOT_FOUND`,
`409 CONFLICT`, `429 RATE_LIMITED` and `503 SERVICE_UNAVAILABLE`.

### Commands and child environment

The executable is the running backend's `node.exe`, followed by the verified npm/pnpm JavaScript entry point.
The app never launches a `.cmd`, builds a shell command, or selects a program from the project folder; a fake
project-local `npm.cmd` or `node.exe` is ignored. Scripts still use the package manager's own script shell.

Each row below follows that entry point and the manager's fixed prefix:

- npm: `--prefix <project> --global=false --no-audit --no-fund --no-progress --update-notifier=false`
- pnpm: `--dir <project> --pm-on-fail=warn`

| Action | npm arguments after prefix | pnpm arguments after prefix |
|---|---|---|
| `install_all` | `install` | `install --no-frozen-lockfile --reporter=append-only` |
| `install_one` | `install --save-prod -- <spec>` | `add --global=false --save-prod --reporter=append-only -- <spec>` |
| `update_all` | `update` | `update --global=false --reporter=append-only` |
| `update_one` | `update -- <name>` | `update --global=false --reporter=append-only -- <name>` |
| `uninstall_one` | `uninstall -- <name>` | `remove --reporter=append-only -- <name>` |
| `script` | `run-script -- <script>` | `run <script>` |

Package names use a restricted registry-name grammar, including scoped names. Only `install_one` accepts an
exact version or dist-tag, such as `@scope/name@1.2.3` or `name@latest`; update/uninstall require a declared
package name without a version. Flags, version ranges, URLs, `file:`, git specs and paths are rejected as
`INVALID_PACKAGE_SPEC` before a process starts. Script names must be declared, nonempty and match
`[A-Za-z0-9][A-Za-z0-9:_-]{0,127}`; arbitrary commands and script arguments are unavailable.

- **Environment:** inherits the user's environment after removing all backend settings-file keys (including
  `PORT`, `HOST`, `SCAN_ROOT_PATHS`), `PKGSTEWARD_DATA_DIR`, `NODE_ENV`, `NODE_OPTIONS`, `INIT_CWD`,
  `PNPM_SCRIPT_SRC_DIR` and every `npm_*` key, case-insensitively. PATH retains absolute entries only.
  Forced values are `NO_COLOR=1`, `FORCE_COLOR=0`, `NoDefaultCurrentDirectoryInExePath=1`,
  `COREPACK_ENABLE_NETWORK=0`, `COREPACK_ENABLE_AUTO_PIN=0` and `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
  For pnpm, `pnpm_config_verify_deps_before_run=false` prevents an install before a script, and
  `pnpm_config_update_notifier=false` disables its update notice. Mutations force `CI=1`; scripts do not force
  it and can inherit the user's value. stdin is closed for all actions.
- **Configuration:** project `.npmrc` or pnpm workspace settings that select global mode, `prefix`, `location`,
  directory redirection or package-manager version management are refused with `CONFIG_UNSUPPORTED`.
  User credentials in the environment and user-level config still apply; user-level config is not inspected.
  pnpm 11 accepts `--global=false` only for `add`/`update`; `install`/`remove` cannot be forced non-global.

### Lifecycle, output and limits

- **One run at a time, machine-wide:** the mutation lock blocks scans, size measurement, package analysis and
  file-operation previews/deletions with `409 CONFLICT`. Existing readers block a start with `READERS_RUNNING`.
  A second run returns `409` with `details: { reason: 'RUNNING', jobId, requestPath }`; the UI can follow it.
  The lock stays held through process verification, project refresh and audit recording.
- **Stop and timeout:** Stop uses `taskkill /T /F` on the tracked tree and requires two empty process snapshots
  to verify termination. Unconfirmed termination produces `termination_failed` and keeps the lock held; retry
  cleanup through cancel. `NPM_COMMAND_TIMEOUT_MS` empty means no limit; a configured deadline produces
  `timed_out`. When the root exits first, tracked children are stopped before completion. Windows ended
  non-detached children when the backend itself was killed in trials; deliberately detached processes can
  escape. After a backend crash, inspect and end leftover processes in Windows Task Manager.
- **Results and refresh:** statuses are `running`, `stopping`, `completed`, `failed`, `cancelled`, `timed_out`,
  `termination_failed`. Inspect `exitCode`, `failureCode`, `terminationVerified`, `gateHeld`, `auditWritten`
  and `refreshRequired`; exit code zero alone does not establish successful finalization or a clean audit.
  After any spawned run, the project's scan entry is refreshed in place (lockfile, manager, activity time),
  cached sizes are cleared and earlier package analysis becomes stale (`INPUT_CHANGED`). Refresh runner context
  before another command. No automatic rescan, analysis, install or retry occurs; newly created project folders
  appear only after a manual scan.
- **Retention:** only the latest run and its output live in memory. Backend restart loses runs and logs;
  the audit log retains intent and result lines in `logs/dangerous-operations.jsonl` inside the data folder.
- **Logs:** the backend retains the last 1 MiB / 4,096 chunks per run and serves pages of at most 64 KiB /
  256 chunks by cursor. Older output is dropped with `OUTPUT_TRUNCATED` and a dropped byte count. ANSI/OSC
  codes are stripped; invalid bytes become U+FFFD with `OUTPUT_ENCODING_LOSS`. Values following `password=`,
  `token:`, `_authToken=` and `Authorization:`, plus URL credentials, are masked. Bare tokens printed by scripts
  (for example, `npm_…`) are **not** masked; do not treat log filtering as a guarantee against secret disclosure.

Failure/reason codes: `PROJECT_NOT_SCANNED`, `INPUT_CHANGED`, `WORKSPACE_LEAF`, `UNSUPPORTED_MANAGER`,
`LOCKFILE_MISMATCH`, `TOOL_NOT_FOUND`, `TOOL_LAYOUT_UNSUPPORTED`, `TOOL_VERSION_MISMATCH`, `CONFIG_UNSUPPORTED`,
`INVALID_PACKAGE_SPEC`, `SCRIPT_NOT_FOUND`, `SCRIPT_NAME_UNSUPPORTED`, `READERS_RUNNING`, `RUNNING`,
`SPAWN_FAILED`, `COMMAND_FAILED`, `CANCELLED`, `TIMED_OUT`, `SHUTDOWN`, `TERMINATION_UNCONFIRMED`,
`AUDIT_WRITE_FAILED`, `CACHE_INVALIDATION_FAILED`, `INTERNAL_SERVER_ERROR`.

Warning codes: `NO_LOCKFILE`, `PACKAGE_MANAGER_PIN_DIFFERS`, `OUTPUT_TRUNCATED`, `OUTPUT_ENCODING_LOSS`,
`LOGS_MAY_CONTAIN_SECRETS`, `PROJECT_CODE_EXECUTION`, `PATH_RACE_RESIDUAL`.

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
  when an audit write or an unexpected error stopped it. A `TARGET_GONE` target leaves the stored scan result, as a
  deleted one does.
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

## Global packages API

List, remove or change an installed global package with **npm 11 or pnpm 11** on Windows. Other pnpm majors
are refused (`TOOL_VERSION_MISMATCH`); Yarn is not supported.
The installed-tool resolver verifies the backend's Node executable and the manager's JavaScript entry point;
unknown versions/layouts and Corepack-only tools are unavailable. The app never installs or switches managers.
An explicit **Refresh** discovers npm locations through read-only manager queries: npm prefix/root/config/cache.
These queries use a neutral working directory, not a scanned project; the tool may still write caches.
pnpm discovery and inventory listing read configuration and filesystem metadata statically; no pnpm command runs
until execute. pnpm globals must already be set up: run `pnpm setup` in a terminal, ensure its global bin directory
is on PATH, open a new terminal, then restart PkgSteward. Otherwise availability reports `PNPM_GLOBAL_NOT_CONFIGURED`.
The app does not run setup or edit PATH. GET requests and page loads only read retained RAM snapshots and never run commands.
Preview and execute recheck the discovered locations and configuration; clients cannot supply paths, argv or environment.

**Only change global packages you trust.** Their lifecycle and transitive code runs with your user privileges,
without a sandbox, and can write across the machine, access the network and start subprocesses. Other programs
using a removed or changed package are affected; the app cannot discover all consumers. Failure, cancellation or
timeout may leave a package partly changed. Processes can escape tracking. After a backend crash, inspect and end
leftover processes in Windows Task Manager before proceeding. There is no rollback.

All routes below use `/api/v1/global-packages` and the standard response envelope, with `Cache-Control: no-store`.

| Endpoint | Body and result |
|---|---|
| `GET /api/v1/global-packages` | `200` with inventory, availability, `asOf` and `stale`, or `data: null` before refresh |
| `POST /api/v1/global-packages/inventory` | `{ requestId }`; `202` with `{ jobId, requestId, previewId, status }` |
| `POST /api/v1/global-packages/versions` | `{ requestId, manager, package }`; `202` with a job whose completed snapshot contains `versions` and `tags` |
| `POST /api/v1/global-packages/preview` | `{ requestId, manager, package, action, targetVersion? }`; `202` with a job whose ready snapshot contains `preview` |
| `POST /api/v1/global-packages/execute` | `{ requestId, previewId, confirm: true, acknowledgedRisks: ["MACHINE_WIDE"], confirmText }`; `202` after preflight with the accepted mutation job |
| `GET /api/v1/global-packages/jobs/latest` | `200` with the latest retained activity, or `data: null` |
| `GET /api/v1/global-packages/jobs/:id` | `200` with job status, preview/version results, exit and cleanup state; no command or filesystem work |
| `GET /api/v1/global-packages/jobs/:id/logs?cursor=0` | `200` with a bounded output page and `nextCursor` |
| `POST /api/v1/global-packages/jobs/:id/cancel` | No body; `200` with current status; cancels or retries cleanup without repeating a mutation |

`manager` is `npm` or `pnpm`; `action` is `remove` or `change`. `targetVersion` is required only for change and
must be a canonical exact version or dist-tag. Ranges, URLs, Git specs, paths, aliases and command flags are refused.
Names may be scoped. IDs and `requestId` are UUID v4; the log cursor is a nonnegative safe integer. Extra fields
are rejected. Only latest/status/log polling bypasses throttling; other requests remain rate limited.

### Preview, protection and registry policy

- **Confirmation:** a ready preview lasts five minutes. Review manager/version, global root, bin directory,
  current and resolved target version, declared bin changes and warnings. Every operation is high risk and
  requires `confirm: true`, acknowledgement of `MACHINE_WIDE`, and the exact, case-sensitive server text:
  `REMOVE GLOBAL <manager> <name>` or `CHANGE GLOBAL <manager> <name> TO <version>`. Whitespace is not trimmed.
  Bin differences describe declared metadata, not all effects of scripts or transitive packages.
- **Revalidation and replay:** execute rechecks tool, location, config, inventory, ownership, package/bin and
  target metadata before mutation. Tags are resolved to an exact version and checked again; moved tags require
  another preview. Wrong consent returns `400 VALIDATION_ERROR`. Changed, expired or consumed previews return
  `409 CONFLICT` with `details.reason` such as `PREVIEW_CHANGED`, `PREVIEW_EXPIRED` or `PREVIEW_CONSUMED`.
  The retained identical request/payload returns its job; mismatched reuse returns `REQUEST_MISMATCH`.
  Unknown/evicted previews and jobs return `404 NOT_FOUND`. A lost response requires checking latest status;
  do not automatically resend execute. Restart loses the in-memory receipt.
- **Protected packages:** `npm`, `corepack`, `pnpm`, `@pnpm/exe`, `yarn`, `@yarnpkg/cli`, `@yarnpkg/cli-dist` and `pkgsteward`.
  Current or target bins named `node`, `npm`, `npx`, `pnpm`, `pnpx`, `yarn`, `yarnpkg`, `corepack` or `pkgsteward`
  are also protected, case-insensitively, including their Windows shim extensions. Overlap with tool distributions,
  the Node executable, app installation, source checkout or data directory is refused. Confirmation cannot override
  protection. Linked packages are read-only (`LINKED_PACKAGE`); unsafe bins, collisions or incomplete ownership
  prevent mutation (`BIN_CONFLICT`).
- **pnpm layout:** inventory validates the versioned global root, group metadata, internal links into the store
  and package/bin ownership. Packages installed together in one `pnpm add -g` are read-only
  (`GLOBAL_GROUP_UNSUPPORTED`): change or removal could affect the whole group; manage them in a terminal.
  Unreferenced physical install directories block change because pnpm add can clean them up; remove does not
  perform that cleanup. Ambiguous, external or incomplete layouts cannot be mutated.
- **Registry:** version lookup and change use only `https://registry.npmjs.org`. Public-registry login tokens in
  user/global config do not disable change; the package manager can consume its config credentials. The app's HTTP
  metadata requests do not forward credentials or follow redirects. A custom/mirror default registry, a scoped
  registry matching the package, or unknown config/environment provenance disables lookup/change with
  `REGISTRY_CONFIG_UNSUPPORTED`; remove remains allowed when location/protection checks pass, without metadata lookup.
  Tool/plugin keys `onload-script`, `pnpmfile`, `global-pnpmfile`, `yarn-path`,
  `manage-package-manager-versions` and `node-options` also disable change. Interpolation and conflicting or unsafe
  location settings are refused. Config secrets are not returned or logged. A typed exact target still requires
  online metadata; selecting the installed version returns `NO_VERSION_CHANGE`. Major changes, downgrades and
  prereleases produce warnings.
- **pnpm configuration:** settings that can load code or move the layout make pnpm read-only
  (`CONFIG_UNSUPPORTED`), including pnpmfile/hooks, `lockfileDir`, layout/workspace directories, shell/Node
  execution options and override/extension maps. Registry restrictions alone still allow remove when the
  location and protection checks pass.

Other HTTP errors include `403 FORBIDDEN` for unsafe/protected targets, `409 CONFLICT` for busy or unsupported
state/configuration (`RUNNING`, `LOCATION_AMBIGUOUS`, `CONFIG_UNSUPPORTED`, `LIMIT_EXCEEDED`),
`429 RATE_LIMITED` and `503 SERVICE_UNAVAILABLE` for unavailable Windows/tool support. Use `code` and
`details.reason`, not message text. A command's nonzero exit is a failed job, not a successful package change.

### Fixed arguments and child environment

Commands launch the verified JavaScript entry point through the backend's `node.exe`, using argument arrays,
closed stdin and no shell launcher. Each npm mutation uses its discovered locations as this fixed prefix:

- npm: `--prefix <prefix> --userconfig <user-config> --globalconfig <global-config> --cache <cache>`

For public-registry operations, append `--registry https://registry.npmjs.org`; removals under unsupported registry
configuration omit it. npm then appends `--no-audit --no-fund --no-progress --update-notifier=false`.
The following arguments come last:

| Action | npm |
|---|---|
| Remove | `uninstall --global -- <name>` |
| Change | `install --global -- <name>@<exact-version>` |

pnpm uses these exact arguments after its JavaScript entry point (`W` = neutral working directory,
`G` = unversioned global base, `B` = global bin directory, `S` = versioned store; all are validated locations):

```text
--dir W --pm-on-fail=warn add --global --global-dir G --global-bin-dir B --store-dir S --registry https://registry.npmjs.org --reporter=append-only -- NAME@EXACT
--dir W --pm-on-fail=warn remove --global --global-dir G --store-dir S --reporter=append-only -- NAME
```

`NAME` is the selected package and `EXACT` the resolved version. Remove takes no registry or bin-directory flag;
its bin directory comes from pinned configuration. pnpm does not receive npm's user/global-config flags.

No arbitrary arguments, elevation, tool-download fallback or automatic mutation retry is available. The child
uses the command runner's sanitized environment: backend settings, `NODE_ENV`, `NODE_OPTIONS`, project-run
markers and `npm_*` keys are stripped, and PATH retains absolute entries only. Global operations additionally
strip inherited `PNPM_*` switches (case-insensitively), `NODE_AUTH_TOKEN`, `COREPACK_NPM_TOKEN` and `YARN_*` keys
before building it. Validated location overrides become explicit flags or pinned pnpm environment settings,
including its home, original auth-file path, cache/state paths and fixed safety settings.
Mutations force `CI=1`, disable Corepack downloads/network/auto-pinning, and disable color output.
This controls launch configuration; it does not isolate lifecycle code.

### Lifecycle, audit and limits

- **Concurrency:** one global activity at a time across both managers, including refresh/version/preview jobs.
  Execute shares the mutation lock with file operations and the project command runner, held through stop,
  verification, audit and cleanup. Read-only global activities use their own slot without taking that lock;
  execute does not wait for existing scans, disk measurements, analyses or file-operation previews.
- **Timeout and stop:** `NPM_COMMAND_TIMEOUT_MS` bounds the activity, including preflight; empty/unset means no
  time limit. Cancellation stops tracked processes and verifies termination using the runner's Windows process
  cleanup. Unverified termination produces `termination_failed` and retains the lock. Cancel retries cleanup,
  including pending finalization, without spawning the mutation again. Poll/log/cancel remain available.
- **Results:** statuses are `running`, `stopping`, `completed`, `failed`, `cancelled`, `timed_out` and
  `termination_failed`. Inspect `mutationSpawned`, `mayHaveChanged`, `exitCode`, `failureCode`,
  `terminationVerified`, `gateHeld`, `auditWritten` and `refreshRequired`. Exit zero alone is insufficient;
  completion also checks the package is absent after remove, or matches the target version/bins after change.
  A failed postcondition reports `POSTCONDITION_FAILED`.
- **Freshness:** any spawned mutation invalidates both managers' inventory and all previews. Inventory is
  refreshed after verified stop; a failed refresh leaves stale/error state. Project scan entries, analyses and
  disk-size caches are not refreshed by this feature. Inspect lifecycle side effects separately and explicitly
  rescan, recheck or remeasure when needed.
- **Audit:** `logs/dangerous-operations.jsonl` in the data folder records intent/result for
  `global-packages.remove`, `global-packages.change` and `global-packages.cancel`, including job/target identity
  and outcome/cleanup facts, without command output, environment or config secrets. Intent failure prevents
  mutation; result-write failure retains the lock. Cancellation still attempts to stop processes if auditing fails.
- **Retention and bounds:** one inventory and the latest activity/log live in RAM; restart loses them. Up to
  16 previews are retained, each bounded to 256 KiB. Config files are limited to 1 MiB each / 8 MiB total;
  inventory to 10,000 rows, depth 64 and 1 MiB per manifest / 32 MiB total. Query output is bounded to 1 MiB per
  location query / 8 MiB per list, with 64 KiB diagnostic stderr. Version options are limited to 10,000;
  metadata is bounded to 4 MiB per exact-version response / 64 MiB per packument, with at most four HTTP requests
  concurrently. Limits fail explicitly rather than reporting an empty success. Output uses the runner's
  1 MiB / 4,096-chunk ring and 64 KiB / 256-chunk pages; older output is dropped and reported. Logs are plain
  text with filtering, but scripts can still print unrecognized secrets.

## Package manager pin API

Read and change the `packageManager` field of **one scanned project's** `package.json`. This is a declaration
only: the app writes that one field, downloads nothing, runs no install and does not use Corepack. It never changes
the npm/pnpm installed on the machine, and the command runner keeps using the installed tool. Terminals follow the
pin only if you use Corepack or pnpm's own package manager version management.

All routes below use `/api/v1/package-managers` and the standard response envelope, with `Cache-Control: no-store`.

| Endpoint | Body and result |
|---|---|
| `GET /api/v1/package-managers/project?path=` | `200` with the current pin (raw, parsed or unsupported), installed npm/pnpm versions read statically (Yarn reported as unsupported), lockfile families, workspace kind, `devEnginesPresent`, a blocking `reason` and notices. No network, no child process, no write |
| `POST /api/v1/package-managers/versions` | `{ requestId, path, manager }`; `202` with a job whose completed snapshot contains `versions` (exact, `supported`, `deprecated`, disabled `reason`) and `tags` |
| `POST /api/v1/package-managers/project/preview` | `{ requestId, path, manager, targetVersion }`; `202` with a job whose ready snapshot contains `preview` |
| `POST /api/v1/package-managers/project/execute` | `{ requestId, previewId, confirm: true, acknowledgedRisks }`; `202` after preflight with the accepted mutation job |
| `GET /api/v1/package-managers/jobs/latest` | `200` with the latest retained job, or `data: null` |
| `GET /api/v1/package-managers/jobs/:id` | `200` with status, phase, preview/version results and write flags |
| `POST /api/v1/package-managers/jobs/:id/cancel` | No body; `200` with current status; cancels before the write or retries cleanup, never writes again |

- **Scope:** `path` must be a project root in the latest scan and pass the path guard. `manager` is `npm` or `pnpm`
  for changes; Yarn pins are shown read-only. A new pin is `<manager>@<exact>` for a **stable, non-deprecated
  version with the same major as the installed tool** (npm 11 / pnpm 11); `targetVersion` may be an exact version
  or a dist-tag resolved to one. An old pin hash is dropped (`PIN_HASH_REMOVED`) and never invented. Workspace
  members (`WORKSPACE_LEAF`), unsupported current values (`PIN_UNSUPPORTED`), `devEngines` (`CONFIG_UNSUPPORTED`)
  and lockfiles of another family (`LOCKFILE_MISMATCH`) are refused.
- **Registry:** version lists come only from `https://registry.npmjs.org` for the package names `npm`, `pnpm`
  and `yarn` (Classic). Requests carry no credentials or project data and do not follow redirects. Project or user
  registry configuration is not consulted; the pin is a declaration that other tools later resolve with their own
  configuration.
- **Preview and execute:** a preview lists the single file edit (current → new), the installed runner version,
  notices and residual risks, and expires after five minutes. Risk is `low`, or `medium` with `RECENTLY_ACTIVE`
  when the project changed in the last seven days; medium needs every code in `acknowledgedRisks`. Execute
  re-reads the scan, project files, identities, tools and the public target, and refuses changes with
  `409 CONFLICT` (`PREVIEW_CHANGED`, `SCAN_CHANGED`, `PREVIEW_EXPIRED`, `PREVIEW_CONSUMED`, `REQUEST_MISMATCH`).
  A retained identical request returns its job; do not automatically resend execute.
- **Write:** the new bytes differ from the original only in the `packageManager` value or its insertion; BOM, line
  endings, key order and indentation are kept. They are written to a sibling temporary file opened exclusively,
  then every identity is rechecked and the file is renamed over `package.json` once, then read back. There is no
  rollback. Job flags: `mutationStarted`, `mayHaveChanged`, `fileCommitted`, `cleanupRequired`. A locked file
  reports `FILE_IN_USE` (unchanged when the original is proven intact); `ACCESS_DENIED`,
  `MANIFEST_WRITE_FAILED`, `POSTCONDITION_FAILED` and `TEMP_CLEANUP_FAILED` are also possible.
- **Residual risks:** another program editing the same `package.json` in the last moment before the rename can
  be overwritten; swapping a parent folder for a junction at that moment is not fully prevented; a crash during
  the write can leave a `package.json.<uuid>.pkgsteward-tmp` file next to it. Inspect and remove it manually.
- **Shared state:** one package manager job at a time (`409 RUNNING`). Execute takes the same mutation lock as
  file operations, the command runner and global packages, records an audit intent before writing and a result
  after, then refreshes that project in the scan cache. `NPM_COMMAND_TIMEOUT_MS` empty means no deadline. Only
  `jobs/latest` and `jobs/:id` polling bypass throttling.

## Documentation

- Project overview and setup: [`README.md`](../../README.md)
- Contributing guide: [`CONTRIBUTING.md`](../../CONTRIBUTING.md)

## License

Copyright (c) 2026 LianHarman (LienThuan04). Released under the [MIT License](LICENSE).

## Third-party licenses

This app depends on open-source packages under their own licenses. Their copyrights belong to their respective
authors. See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the full list with versions and licenses.
