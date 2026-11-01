# pkgsteward_fe

Frontend of **PkgSteward**. Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS v4, shadcn/ui (Radix),
next-themes and next-intl.

> [!NOTE]
> Next.js 16 has breaking changes compared to older versions. The bundled docs live in
> `node_modules/next/dist/docs/`.

## Run

Requirements: Node 24, pnpm 11.

```bash
pnpm install
pnpm dev        # http://localhost:24680
```

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build / serve it |
| `pnpm lint` | ESLint (including the theme rules below) |
| `pnpm theme:check` | Check WCAG 2.1 AA contrast for every preset in `styles/themes/` |
| `pnpm i18n:check` | Compare each locale's keys with the default locale (`vi`): extra keys fail, missing keys only warn |

## Frontend listen address

Set these variables in `pkgsteward_fe/.env.local` or `pkgsteward_fe/.env`:

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

In `pkgsteward_fe/`, copy `.env.example` to `.env.local` before starting the frontend:

```powershell
Copy-Item .env.example .env.local
```

`API_BASE_URL` defaults to `http://127.0.0.1:24681/api/v1`. Its host and port must match
`HOST` and `PORT` in `pkgsteward_be/.env`; update `API_BASE_URL` whenever the backend address changes.
Use `http://[::1]:24681/api/v1` for an IPv6 loopback backend.
This variable is read only on the server; do not add the `NEXT_PUBLIC_` prefix.
Start the backend first by running `pnpm dev` in `pkgsteward_be/`, then start the frontend as above.

The server loads the initial scan results. Browser scan requests use same-origin Route Handlers at
`/api/scans`, `/api/scans/[id]` and `/api/scans/[id]/cancel`; the server calls the backend.
Backend requests time out after 10 seconds. If the backend is offline or a request times out, the page
shows a localized `BACKEND_UNAVAILABLE` error state instead of crashing.

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
app/api/              Same-origin scan, disk usage and file operation Route Handlers
components/ui/        shadcn/ui components (adapted to the theme tokens)
components/layout/    Top / mobile navigation, container, nav items
components/theme/     Theme provider, mode toggle
components/i18n/      Language switcher
i18n/, messages/      next-intl config and translations
hooks/                Client scan, disk usage, file operation and file tree state
lib/api/              Backend client, transport, contracts and feature requests
lib/disk-usage/       Measurement polling and presentation policy
lib/file-ops/         Selection, confirmation, deletion flow and list helpers
lib/projects/         Project filtering, sorting and display helpers
lib/scans/            Scan polling and completion policy
lib/theme/            Theme preset registry
styles/               Theme presets and tokens
scripts/              theme:check and i18n:check
```

## Contributing

See [`CONTRIBUTING.md`](../CONTRIBUTING.md).
