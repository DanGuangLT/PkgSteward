# @pkgsteward/web

**Web UI for PkgSteward - local manager for Node.js projects and their npm / pnpm / Yarn packages**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Frontend of **PkgSteward**. Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS v4, shadcn/ui (Radix),
next-themes and next-intl.

> [!NOTE]
> Next.js 16 has breaking changes compared to older versions. The bundled docs live in
> `node_modules/next/dist/docs/`.

## Requirements

Node 24, pnpm 11. Target platform: Windows 11.

## Install

Run inside `apps/web/`:

```bash
pnpm install
```

## Run

```bash
pnpm dev        # http://localhost:24680
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build / serve it |
| `pnpm lint` | ESLint (including the theme rules below) |
| `pnpm theme:check` | Check WCAG 2.1 AA contrast for every preset in `styles/themes/` |
| `pnpm i18n:check` | Compare each locale's keys with the default locale (`vi`): extra keys fail, missing keys only warn |

## Frontend listen address

Set these variables in `apps/web/.env.local` or `apps/web/.env`:

| Variable | Default when empty or unset | Allowed values |
|---|---|---|
| `PORT` | `24680` | Decimal integer from `1` to `65535` |
| `HOST` | `127.0.0.1` | `127.0.0.1`, `localhost` or `::1` only |

For each variable, the first nonempty value wins: real environment → `.env.local` → `.env` → default.
Whitespace-only values count as empty. `pnpm dev` and `pnpm start` validate the address before starting Next.js;
invalid values stop startup with an error. The Host/Origin checks follow the configured port.

When changing the frontend's `PORT` or `HOST`, update the backend's `LIST_ORIGIN_CORS` to match the frontend
origin used in your browser (for example, `http://localhost:24680`; IPv6 uses `http://[::1]:24680`).

## Backend connection

In `apps/web/`, copy `.env.example` to `.env.local` before starting the frontend:

```powershell
Copy-Item .env.example .env.local
```

`API_BASE_URL` defaults to `http://127.0.0.1:24681/api/v1`. Its host and port must match
`HOST` and `PORT` in `apps/api/.env`; update `API_BASE_URL` whenever the backend address changes.
Use `http://[::1]:24681/api/v1` for an IPv6 loopback backend.
This variable is read only on the server; do not add the `NEXT_PUBLIC_` prefix.
Start the backend first by running `pnpm dev` in `apps/api/`, then start the frontend as above.

The server loads the initial scan results. Browser scan requests use same-origin Route Handlers at
`/api/scans`, `/api/scans/[id]` and `/api/scans/[id]/cancel`; the server calls the backend.
Backend requests time out after 10 seconds. If the backend is offline or a request times out, the page
shows a localized `BACKEND_UNAVAILABLE` error state instead of crashing.

## Project details and package checks

Select **View details** in the project list to open `/projects?path=...`. A single path is required; missing,
invalid, deleted or no-longer-scanned projects show a localized guide/error with a link back to the list.
Opening, prefetching, reloading or refreshing the page reads local detail only, without starting a scan or
online check. The list retains its selection, size and file-operation controls without per-row data requests.

The initial view shows manifest dependencies, declared specs/groups, locked versions, detected manager and pin,
read time, scripts as inert text, and an existing cached `node_modules` size. Installed tool versions remain
unknown. This section offers no Install, Update or Fix controls; commands live in the separate panel described
in [Run project commands](#run-project-commands). Unknown values are distinct from known empty
results. A missing cached size links to `/disk-usage?path=...&view=packages`, without starting measurement.

**Check packages** explicitly sends dependency names and versions to the public npm registry. Project-level
registry/authentication configuration disables this button with an explanation; local detail remains available.
Results cover **locked versions**, rather than the installed tree. The vulnerability scope includes every npm
registry package entry at the chosen lock root, including other workspaces/importers; direct status uses only
root declarations. Supported audit locks are npm v2/v3, pnpm v9 and Yarn Classic v1. Yarn Berry/other unsupported,
missing or mismatched locks have unavailable audit coverage, even when wanted/latest metadata is available.

The desktop dependency table becomes cards on narrow screens, with no filtering, search, tabs or paging.
Outdated/vulnerable badges indicate available findings, including partial ones; absent badges do not assert
clean results. Advisory findings sort by severity, package name and ID. Titles are text, and only backend-validated
advisory URLs are links. A deprecated version is a row warning and does not alone make a check incomplete.

The browser uses same-origin Route Handlers; the server calls the backend:

| Endpoint | Purpose |
|---|---|
| `GET /api/projects?path=...` | Local detail read |
| `POST /api/projects/analyses` | Start an explicit check |
| `GET /api/projects/analyses/:id` | Read a job snapshot |
| `POST /api/projects/analyses/:id/cancel` | Request cancellation |

One poll is in flight at a time, with the next scheduled one second after settlement. Hiding the tab aborts
local polling; showing it resumes. Terminal states stop polling. Poll failures pause until **Check status again**;
a lost job (`404`, for example after restart or replacement) retains old findings as unverified. Cancellation
failure says its outcome is unconfirmed; start transport failure says its outcome is unknown. Neither POST is
automatically retried. An analysis conflict links to the other project's detail page, preserving its lexical
path; it never displays that project's findings under the current project's summary. Other conflicts have no link.

Completed, partial, stale, unavailable, cancelled and timed-out states remain distinct. A no-vulnerabilities
claim requires a complete, current audit with no findings. `checkedAt` is the historical end-of-job input check,
and polling never revalidates files. **Refresh local data** is available after tracking ends and marks old analysis
stale when the input hash or scan changes. Leaving the page aborts local requests only; the backend may continue
until explicit cancellation or the optional configured deadline. There is no default analysis time limit.

## Run project commands

The project detail page (`/projects?path=...`) also has a separate **Run project commands** panel with the
installed tool version and canonical target path. The local-detail fields described above remain read-only;
this panel provides **Run** for install all, install one package, update all, update one, uninstall one, or one
declared script. Selecting **Run** starts immediately in one click, without a confirmation dialog. Opening or
refreshing the page never starts a command.

**Only run projects you trust.** Commands execute project and lifecycle code with your user rights and no
sandbox. `.npmrc`, pnpmfile and plugins may execute code or affect tool behavior. Commands may use the network,
shared stores and files outside the project; logs may reveal secrets despite filtering. There is no rollback,
and stopping or failure can leave partial changes. Stop may miss processes that escape the tracked tree.
Replacing the project folder through a junction swap at the exact moment of launch is not fully prevented.

With npm 12, dependency lifecycle scripts may be skipped even when the command exits zero unless the root
project's `allowScripts` permits them. Root and explicitly run scripts still execute; root `preinstall` runs before
dependencies are installed. Inspect `allowScripts` yourself: the app does not approve scripts, rebuild packages
or recover missing build artifacts. Arguments and environment are unchanged; the app adds no ignore-scripts,
allow-scripts or strict-npmrc overrides. Strict npm configuration failures fail the job without an automatic retry.

- **Tools and inputs:** npm 11, npm 12 and pnpm 11; npm 12 prereleases and other majors are refused.
  Previously verified with npm 11.17.0, pnpm 11.22.0 and Node 24.19.0; npm 12 support is pending real-run
  verification.
  Installed npm 12 needs valid `engines.node` metadata satisfied by the backend's Node: missing/malformed metadata
  returns `TOOL_LAYOUT_UNSUPPORTED`, incompatible/invalid Node returns `TOOL_VERSION_MISMATCH`. With installed
  npm 12, any `npm-shrinkwrap.json` (even alongside `package-lock.json`) refuses every action with
  `CONFIG_UNSUPPORTED`; nothing is converted, deleted or renamed.
  Yarn and unresolved/Corepack-only tools are unavailable; the app does not download or switch tools. The pin
  must match the installed major; other differences warn. Workspace roots allow all actions, members scripts
  only. Install one accepts a package name with an optional exact version or dist-tag; update/uninstall accept
  a name only. Ranges, URLs, paths and command flags are unavailable. Scripts come from `package.json` and use
  supported declared names; there is no arbitrary command input.
- **Tracking and conflicts:** only one command runs at a time, machine-wide. It blocks scans, size measurements,
  package analysis and file-operation previews/deletions. A conflict with a running command offers
  **Follow the active command**, including a link to another project when applicable. Hiding the tab or leaving
  the page does not stop the backend command. A lost start response is unconfirmed; refresh status to check it.
  The app never automatically resends a command.
- **Stopping:** **Stop** requests termination of the tracked process tree. Unverified termination keeps the
  mutation lock held and exposes **Retry process cleanup**; this retries cleanup without running the command
  again. A lost Stop response is also unconfirmed; refresh status before requesting another stop. Empty
  `NPM_COMMAND_TIMEOUT_MS` means no time limit. Actual exit code, stop reason, failure code and cleanup state
  remain visible; a stopped/failed command may have changed the project.
- **Refresh:** **Refresh context and status** reads current runner data. After a spawned command, the backend
  refreshes that project's scan entry, clears cached sizes and marks earlier package analysis stale. The panel
  re-reads the runner context itself; scan manually to discover new project folders, measure again for new sizes, and
  select **Check packages** for a new analysis. None of those actions is started automatically. A successful
  install does not establish that vulnerability checks are complete or have no findings.
- **Logs:** stdout/stderr appear as plain text. The browser retains the last 512 KiB / 2,048 chunks, while the
  backend retains 1 MiB / 4,096 chunks; older output is dropped and counts are shown. Autoscroll follows output
  only while you are within 24 px of the bottom; **Jump to latest** resumes it. ANSI/OSC codes are stripped and
  decoding loss is reported. Known credential patterns are masked, but bare tokens printed by scripts are not.
  Logs survive refreshing page data/context while the panel stays mounted. An F5 reload of a finished run
  loses the displayed logs; backend restart forgets all runs and logs. If tracking is lost, a retained local
  tail does not prove processes stopped. The audit log retains intent and result records.

Browser requests use same-origin Route Handlers under `app/api/npm-runs/**`; the server calls the backend:
`GET /api/npm-runs/context?path=...`, `POST /api/npm-runs`, `GET /api/npm-runs/latest`,
`GET /api/npm-runs/:id`, `GET /api/npm-runs/:id/logs?cursor=...`, and `POST /api/npm-runs/:id/cancel`.
For fixed command arguments, environment/config limits and process cleanup details, see the backend's
[Command runner API](../api/README.md#command-runner-api).

## Disk usage

Open `/disk-usage`, enter an absolute directory path, choose `directory` or `packages`, then select **Measure size**.
The `packages` view expects a `node_modules` path. The project list's **View size** link opens this form;
`?path=...&view=...` only prefills it and never starts a measurement automatically.

Browser requests use same-origin Route Handlers; the server calls the backend:

| Endpoint | Purpose |
|---|---|
| `POST /api/disk-usage` | Start a measurement |
| `GET /api/disk-usage/:id` | Read the current snapshot (`Cache-Control: no-store`) |
| `POST /api/disk-usage/:id/cancel` | Cancel the measurement |

Polling keeps one request in flight and waits 1 second after each response before polling again. It pauses while
the tab is hidden, resumes when visible, and stops when the job ends. A polling error pauses polling until
**Retry progress check** is selected. A `409 CONFLICT` offers to follow the running job. If a backend restart loses the
job (`404 NOT_FOUND`), the UI keeps the last snapshot and offers **Recalculate displayed result** to measure again.

Sizes are **unique apparent bytes**: each hardlinked file is counted once per measurement. They do not represent
allocated disk space or reclaimable space. Partial results are lower bounds, and breakdown rows need not add up
to the total because they can share hardlinks. Expand a directory or package only after the current job ends;
each expansion starts a separate directory measurement. Breadcrumb history keeps up to 16 ancestor snapshots,
and going back restores a snapshot without measuring again. **Recalculate displayed result** forces a fresh measurement and clears
the backend size cache; ordinary measurements may reuse cached results.

## File operations

**Cleanup** (`/cleanup`) finds `node_modules`, `node_modules` without a project and build cache folders in the latest
scan. **Project files** (`/files?path=...`, opened from **Manage files** in the project list) shows one folder level at a
time, with checkboxes, plus shortcuts to delete `node_modules` or the whole project. Opening or reloading either page
never starts anything.

Every deletion follows the same steps:

1. **Preview.** The backend measures each target and assesses its risk. Nothing is deleted. Measuring can be stopped;
   measured items stay selectable.
2. **Review.** Cleanup preselects what the backend recommends; items without a lockfile, cache folders and orphans start
   unselected. Paths chosen in the file tree all start selected.
3. **Confirm.** Low risk needs the confirm button, medium needs every risk ticked, and high also needs the exact text
   shown in the dialog. Cancel has focus when the dialog opens.
4. **Delete.** Items are deleted one at a time and each reports its own result. **Stop** takes effect after the current
   item; that item cannot be interrupted.

`node_modules` and build cache folders are deleted permanently. Whole projects and project content go to the Windows
Recycle Bin and are never deleted permanently as a fallback.

**Estimated space freed** counts only files with no links outside the deleted items, so files shared with the pnpm store
are not included. Recycle Bin items free their space when the bin is emptied, so they are reported separately.

Browser requests use same-origin Route Handlers under `/api/file-ops/`, which mirror the backend's file operations API.
Polling works as it does for disk usage. The deletion request has no client timeout because the backend rechecks every
target first. If its response is lost, the page says the outcome is unknown and never resends by itself: **Send the
delete request again** is safe, because a preview runs only once and the backend returns the same operation.

While the page is idle it checks about every 3 seconds for a running deletion, so a deletion started earlier, or in another
tab, is picked up. After a reload the page also resumes a preview it started, using `sessionStorage`. A preview started in
another tab cannot be resumed; wait for it to finish before starting a new one.

## Global packages

Open `/global-packages` to manage installed global packages with **npm 11, npm 12 or pnpm 11**. npm 12 prereleases
and other majors are refused (`TOOL_VERSION_MISMATCH`). Installed npm 12 needs valid `engines.node` metadata
satisfied by the backend's Node: missing/malformed metadata returns `TOOL_LAYOUT_UNSUPPORTED`, incompatible/invalid
Node returns `TOOL_VERSION_MISMATCH`. Previously verified with npm 11.17.0, pnpm 11.22.0 and Node 24.19.0;
**npm 12 support and its global script behavior are pending real-run verification**. Yarn is not supported;
missing, Corepack-only or unsupported tools show an unavailable reason. Opening or reloading the page reads
retained inventory and job state only, without starting a command. Select **Refresh** to discover global locations
and read the installed inventory. pnpm discovery and listing read configuration and filesystem metadata statically;
no pnpm command runs until execute. Each manager tab shows tool version, global root, bin directory, package
versions and bins, with an as-of time and stale indicator. Empty, unavailable, protected, linked and invalid
states remain distinct; protected and linked packages have no mutation controls.

If pnpm reports `PNPM_GLOBAL_NOT_CONFIGURED`, run `pnpm setup` in a terminal, ensure its global bin directory
is on PATH, open a new terminal, then restart PkgSteward. The app does not run setup or edit PATH.
Packages installed together in one `pnpm add -g` are read-only (`GLOBAL_GROUP_UNSUPPORTED`); manage them in a
terminal because a change or removal could affect the whole group. Configuration that can load code or move
the layout also makes pnpm read-only (`CONFIG_UNSUPPORTED`), including pnpmfile/hooks, `lockfileDir`,
layout/workspace directories, shell/Node execution options and override/extension maps. Inherited `PNPM_*`
switches are stripped before commands run; only validated location and safety settings are supplied.

**Only change global packages you trust.** Lifecycle and transitive code runs with your user privileges,
without a sandbox, and can affect the whole machine. Other programs using the package may break. A failed,
cancelled or timed-out change can leave the package partly changed. Processes can escape tracking; after a
backend crash, inspect and end leftover processes in Windows Task Manager. There is no rollback.

- **Remove or change:** Remove starts a preview. Change immediately loads a selectable list of versions and
  dist-tags from `https://registry.npmjs.org`, newest versions first with the installed version marked.
  Typing an exact version or tag is an optional alternative; **Load versions** reloads the list. **Preview** resolves the chosen
  target to an exact version. Ranges, URLs, paths and command flags are unavailable. Custom/mirror registries,
  matching scoped registries or unsupported tool/plugin configuration disable change; remove can remain available.
  Public npm registry login tokens do not by themselves disable change. Package managers, Node/app files and
  protected command bins cannot be changed here, including `@pnpm/exe` and the pnpm tool itself.
- **Review and confirm:** the dialog shows manager/version, package, location, current → exact target (or removal),
  declared bin additions/removals/replacements, high risk, and lifecycle/consumer/partial-change/crash warnings.
  Tick the machine-wide risk acknowledgement and type the exact displayed text:
  `REMOVE GLOBAL <manager> <name>` or `CHANGE GLOBAL <manager> <name> TO <version>`.
  Cancel has initial focus. Previews expire after five minutes; changing manager/package/action/target clears
  earlier consent. Expiry or a `409` conflict requires another preview; execution is never automatic.
- **Track and stop:** the activity panel shows status, phase, exit code, signal, stop reason, warnings and plain-text
  output. The active control shows a spinner and action-specific loading text, announced to screen readers;
  competing actions are disabled. Cancel requests process termination. **Retry cleanup** retries pending termination/finalization while
  the lock remains held, without running the mutation again. Only one global activity runs at a time across
  both managers; mutations share the lock with file deletions and project commands. Leaving or hiding the page
  does not cancel backend work. Empty `NPM_COMMAND_TIMEOUT_MS` means no time limit.
- **Unknown outcomes:** a lost start/cancel response is unconfirmed. Refresh activity status to recover the latest
  job; retry polling after a poll error. A lost job after restart/replacement does not prove processes stopped.
  The page blocks new actions during unresolved tracking and never automatically retries execute or cancel.
  Backend restart loses retained jobs and output; intent/result records remain in the audit log.
- **Refresh after changes:** any spawned mutation invalidates inventory and previews for both managers, even on
  failure, cancellation or timeout. A visible outcome remains after execution, including a translated failure reason.
  Verified success automatically starts one inventory refresh after finalization and log drain. Failure retains
  the displayed rows; if the mutation command never started, the outcome states that this operation changed nothing.
  A spawned command may have left partial changes. Stale/refresh-required messages remain visible when refresh cannot finish;
  use Refresh before relying on the package list again. This feature does not refresh project scan entries,
  package analyses or disk sizes. Check possible lifecycle side effects separately and explicitly rescan,
  recheck or remeasure when needed.

Browser requests use same-origin Route Handlers; the server calls the backend:

| Endpoint | Purpose |
|---|---|
| `GET /api/global-packages` | Read retained inventory without starting commands |
| `POST /api/global-packages/inventory` | Explicitly refresh inventory |
| `POST /api/global-packages/versions` | Load public registry versions/tags |
| `POST /api/global-packages/preview` | Prepare a remove/change preview |
| `POST /api/global-packages/execute` | Submit the displayed preview and explicit consent |
| `GET /api/global-packages/jobs/latest` | Recover the latest activity |
| `GET /api/global-packages/jobs/:id` | Read activity status and preview/version results |
| `GET /api/global-packages/jobs/:id/logs?cursor=...` | Read output by cursor |
| `POST /api/global-packages/jobs/:id/cancel` | Cancel or retry cleanup |

Execute/cancel have no client timeout or automatic POST retry. Active tracking polls about once per second,
pauses when hidden and resumes when visible. Logs are bounded plain text, with dropped output reported;
filtering cannot hide every secret a script prints. For exact API bodies/status codes, protected names,
registry rules, fixed command arguments and limits, see [Global packages API](../api/README.md#global-packages-api).

## Project package manager pin

The project detail page has a **Project package manager version** panel. It shows the project's declared
`packageManager` value, the npm/pnpm versions installed on this machine (Yarn is shown as unsupported), and when
they were read. This is a **project** setting: it changes one field in that project's `package.json` and never
changes the npm/pnpm installed on the machine.

1. Choose `npm` or `pnpm`, then **Load versions**. The list comes from the public npm registry and shows only
   stable, non-deprecated versions with the same major as the installed tool (npm 11, npm 12 or pnpm 11).
2. Pick a version and **Preview change**. Escape stops a preview that is still loading.
3. The confirmation dialog shows the project, the single `package.json` edit (current value → new value), the
   installed tool PkgSteward keeps using, notes (an old pin hash is dropped; the pin does not switch the tool
   PkgSteward runs) and the remaining risks. A medium-risk preview (project active in the last 7 days) needs each
   reason ticked. Cancel is focused first.
4. **Write pin to package.json** writes only that field. Nothing is downloaded or installed and Corepack is not used;
   terminals follow the pin only if you use Corepack or pnpm's own version management.

An old npm 11 pin can be repaired to installed npm 12, and vice versa; targets must match the installed major
and all other checks still apply. A pin is a declaration, not activation or proof of engine compatibility:
the same-major target's Node engines are not checked. npm 12 support is pending real-run verification.

Pins that are not `<name>@<exact version>`, workspace members, projects with `devEngines`, projects with
`npm-shrinkwrap.json` while npm 12 is installed (even alongside `package-lock.json`), and lockfiles that do not
match the chosen manager cannot be changed here. A lost response is recovered from the latest job, never by sending
the change again; if the result is unknown, open `package.json` to check it. Opening the page only reads; versions are
fetched only when you ask. See [Package manager pin API](../api/README.md#package-manager-pin-api).

## Theme system

Three layers, so a component never hard-codes a color:

1. `styles/themes/<id>.css` — the real values of one preset, light and dark (`[data-theme="<id>"]`, `.dark`).
2. `styles/tokens.css` — maps the semantic variables to Tailwind utilities (`bg-primary`, `text-muted-foreground`,
   `rounded-md`, `shadow-modal`, …).
3. Components — use only those token classes.

ESLint (in `app/`, `components/`, `hooks/`) rejects fixed palette classes (`bg-red-500`), hex values in classes
(`bg-[#fff]`) and `dark:` variants. Use `cn` from `@/lib/utils`, which knows the theme's custom tokens.

Light / dark / system mode is handled by next-themes. The default preset is `pinterest` (inspired by Pinterest's public
design); the selected preset is stored in a cookie so the server renders it directly.

To add a preset: create `styles/themes/<id>.css` and import it in `app/globals.css`, add `<id>` to
`lib/theme/presets.ts`, add its display name under `theme.presets.<id>` in `messages/*.json`, then run
`pnpm theme:check`.

## Internationalization

Locales: Vietnamese (`vi`, default) and English (`en`), chosen with the `NEXT_LOCALE` cookie (no locale prefix in
URLs). Missing keys fall back to Vietnamese, and translation keys are type-checked through `global.d.ts`.

To add a language: copy `messages/en.json` to `messages/<code>.json` and translate it, add `<code>` and its label in
`i18n/config.ts`, then run `pnpm i18n:check`.

## Structure

```
app/                  Routes, root layout, global styles
app/api/              Same-origin scan, project analysis, disk usage and file operation Route Handlers
components/ui/        shadcn/ui components (adapted to the theme tokens)
components/layout/    Top / mobile navigation, container, nav items
components/theme/     Theme provider, mode toggle
components/i18n/      Language switcher
i18n/, messages/      next-intl config and translations
hooks/                Client scan, project analysis, disk usage, file operation and file tree state
lib/api/              Backend client, transport, contracts and feature requests
lib/disk-usage/       Measurement polling and presentation policy
lib/file-ops/         Selection, confirmation, deletion flow and list helpers
lib/projects/         Project list helpers, analysis session/policy and detail presentation
lib/scans/            Scan polling and completion policy
lib/theme/            Theme preset registry
styles/               Theme presets and tokens
scripts/              theme:check and i18n:check
```

## Contributing

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## License

Copyright (c) 2026 LianHarman (LienThuan04). Released under the [MIT License](LICENSE).

## Third-party licenses

This app depends on open-source packages under their own licenses. Their copyrights belong to their respective
authors. See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the full list with versions and licenses.
