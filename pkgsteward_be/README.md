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
| `PKGSTEWARD_DATA_DIR` | *(empty)* | Folder for runtime data (logs, cache, `settings.json`); empty means `%LOCALAPPDATA%\PkgSteward` |
| `NPM_COMMAND_TIMEOUT_MS` | `360000` | Timeout for npm / pnpm / Yarn commands |

Values in settings.json inside the data folder override environment variables.

## Documentation

- Project overview and setup: [`README.md`](../README.md)
- Contributing guide: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
