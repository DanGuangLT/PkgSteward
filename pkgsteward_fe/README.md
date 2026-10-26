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

## Backend connection

In `pkgsteward_fe/`, copy `.env.example` to `.env.local` before starting the frontend:

```powershell
Copy-Item .env.example .env.local
```

`API_BASE_URL` defaults to `http://127.0.0.1:24681/api/v1`. Its host and port must match
`HOST` and `PORT` in `pkgsteward_be/.env`; use `http://[::1]:24681/api/v1` for an IPv6 loopback backend.
This variable is read only on the server; do not add the `NEXT_PUBLIC_` prefix.
Start the backend first by running `pnpm dev` in `pkgsteward_be/`, then start the frontend as above.

The server loads the initial scan results. Browser scan requests use same-origin Route Handlers at
`/api/scans`, `/api/scans/[id]` and `/api/scans/[id]/cancel`; the server calls the backend.
Backend requests time out after 10 seconds. If the backend is offline or a request times out, the page
shows a localized `BACKEND_UNAVAILABLE` error state instead of crashing.

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
app/api/              Same-origin scan Route Handlers
components/ui/        shadcn/ui components (adapted to the theme tokens)
components/layout/    Top / mobile navigation, container, nav items
components/theme/     Theme provider, mode toggle
components/i18n/      Language switcher
i18n/, messages/      next-intl config and translations
hooks/                Client scan polling and cancellation
lib/api/              Backend client, transport, contracts and scan requests
lib/projects/         Project filtering, sorting and display helpers
lib/scans/            Scan polling and completion policy
lib/theme/            Theme preset registry
styles/               Theme presets and tokens
scripts/              theme:check and i18n:check
```

## Contributing

See [`CONTRIBUTING.md`](../CONTRIBUTING.md).
