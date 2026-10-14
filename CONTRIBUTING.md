# Contributing to PkgSteward

Thanks for your interest in PkgSteward! This guide explains how to set up the project, the rules every change must
follow, and how to send a pull request.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
For security issues, **do not open a public issue**: follow [SECURITY.md](SECURITY.md).

## Before you start

- For anything larger than a small fix, **open an issue first** so we can agree on the approach.
- Good first contributions: documentation, tests, accessibility and translation fixes, bug reports with clear
  reproduction steps.

## Development setup

Requirements: **Node.js 24** (see [`.nvmrc`](.nvmrc)) and **pnpm 11**. Windows 11 is the primary target.

```bash
git clone https://github.com/<your-username>/PkgSteward.git
cd PkgSteward

cd pkgsteward_be && pnpm install && cp .env.example .env && cd ..
cd pkgsteward_fe && pnpm install && cd ..
```

Run `pnpm dev` in `pkgsteward_be/` (API on `http://localhost:8080/api/v1`) and in `pkgsteward_fe/`
(UI on `http://localhost:3000`), or run `start-dev.bat` from the repository root to start both on Windows. The two
apps are independent pnpm projects with their own lockfiles.

pnpm 11 only runs dependency build scripts that are listed in each app's `pnpm-workspace.yaml` (`allowBuilds`).
If you add a dependency that needs a build script, add it there.

## Project rules

These rules are not negotiable; reviews will ask for changes if they are not followed.

### Scope

- **Local, single-user tool:** do not add authentication, accounts, a database, Redis or similar. Data comes from
  the filesystem at request time.
- Do not change the API response shape (`{ statusCode, message, data }` from controllers; errors are formatted by the
  global exception filter).

### Safety (any module that deletes files or changes the environment)

- Use a **preview → execute** pair of endpoints. `execute` must require an explicit `confirm: true` and must be
  audit-logged. The UI must show the preview and ask for confirmation before calling `execute`.
  Every preview reports a risk level (`low` / `medium` / `high`) with reasons; the higher the risk, the stricter the
  confirmation (acknowledge each reason, then retype a confirmation text). The server recalculates risk on `execute`.
- Every path from the client must be resolved with `path.resolve()` **and** `realpath` (to block symlink / junction
  escapes) and must be inside `SCAN_ROOT_PATHS` (`*` means every local fixed drive) and outside the built-in list of
  protected system paths, which applies even when `*` is set.
- Run external commands with `execa` using an **argument array** (never a shell string), with the
  `NPM_COMMAND_TIMEOUT_MS` timeout. Never retry a dangerous command automatically.
- **Tests must mock `execa` and the filesystem.** Never run real global commands (`npm -g`, `pnpm -g`, `yarn global`,
  `nvm install/use`, `corepack enable/use`) from tests or development scripts.

### Backend conventions (`pkgsteward_be/`)

- One folder per feature: `src/<feature>/` with `dto/`, `entities/`, `interfaces/`, `<feature>.controller.ts`,
  `<feature>.service.ts`, `<feature>.module.ts`.
- Controllers and services implement interfaces from `interfaces/` (`import type` for interfaces).
- DTOs use `class-validator` + `@nestjs/swagger` decorators with clear English messages.
- Throw the existing `AppException` subclasses from `src/common/exceptions/app.exception.ts`, never a bare `Error`.
- Reuse `src/common/pagination/` for lists that can grow.
- Use the `@/` path alias for internal imports. Prettier: single quotes, trailing commas.
- Names: files `kebab-case.<role>.ts`, classes `PascalCase`, interfaces prefixed with `I`.

### Frontend conventions (`pkgsteward_fe/`)

- Colors, radii, font sizes and shadows come only from theme tokens (`bg-primary`, `text-muted-foreground`, …).
  ESLint rejects palette classes (`bg-red-500`), hex values in classes and `dark:` variants. Import `cn` from
  `@/lib/utils`. See [`pkgsteward_fe/README.md`](pkgsteward_fe/README.md#theme-system).
- Every user-facing string goes through next-intl. Add new keys to **both** `messages/vi.json` (default locale) and
  `messages/en.json`.
- Prefer Server Components; keep client components small. API calls will go through a shared `lib/api/*` client
  (planned), not `fetch` scattered in components.
- Next.js 16 has breaking changes; check `node_modules/next/dist/docs/` rather than relying on older examples.

### Language

Code, identifiers, commit messages and public documentation are in **English**. Code comments may be in English or
Vietnamese.

## Before opening a pull request

Run the same checks as CI in every app you changed:

| App | Commands |
|---|---|
| Backend | `pnpm lint` · `pnpm build` · `pnpm test` · `pnpm test:e2e` |
| Frontend | `pnpm lint` · `pnpm build` · `pnpm theme:check` (styles changed) · `pnpm i18n:check` (messages changed) |

Note: the backend `pnpm lint` runs ESLint with `--fix`. Commit the fixes it makes: CI runs it too and fails if it
modifies any file.

## Commits and branches

- Branch names: `feat/<short-description>`, `fix/…`, `docs/…`, `chore/…`.
- Use [Conventional Commits](https://www.conventionalcommits.org/). Scope = backend module or frontend area, e.g.
  `feat(scanner): add ScannerService.scanRoots`, `fix(file-ops): reject paths outside SCAN_ROOT_PATHS`,
  `feat(ui): add project list`, `feat(i18n): add Japanese messages`, `docs: …`, `chore: …`, `ci: …`, `test(be): …`.
- Keep commits small and focused; do not mix backend and frontend changes in one commit.

## Pull request process

Nobody pushes to `main` directly, including the maintainer's collaborators. Every change lands through a pull request.

1. Fork the repository (or, if you were invited as a collaborator, work on your own branch) and create a branch from
   the latest `main`.
2. Make your change with tests where it makes sense. One pull request = one module or one focused change.
3. Run the checks above and make sure CI is green.
4. Open a pull request against `main` and fill in the template: what changed, why, how you tested it, screenshots for
   UI changes, and what is still missing if the work is only part of a module (mark it as a draft).
5. The maintainer is automatically requested for review (see [`.github/CODEOWNERS`](.github/CODEOWNERS)). Review covers
   the diff, the CI result and a local run of the checks. A pull request is merged only after the maintainer
   approves it.
6. Address review comments by pushing more commits to the same branch; do not open a new pull request.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
