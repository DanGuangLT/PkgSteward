# Changelog

All notable changes to **PkgSteward** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

First stable release of **PkgSteward**, a local single-user Windows workspace to scan, inspect, measure, clean, and manage Node.js / npm / pnpm / Yarn projects on your machine. Requires Node.js 22.18 or newer; development uses Node.js 24.

### Highlights since `v0.2.4-alpha`

- **Unified Settings:** Manage appearance, navigation, language, pagination, scan roots, and timeouts in one place. Runtime settings apply live; server settings that need a restart are flagged. Export, import, and reset the `settings.json` v1 configuration. Runtime and server changes use preview and confirmation.
- **Plugins & Wallpapers:** Install or remove compatible plugins with preview and confirmation. The removable Wallpaper Engine plugin supports images, video, and built-in animations. Other compatible wallpaper plugins can render HTML in a sandboxed frame.
- **pnpm 12 project and global package support:** Native `pnpm.exe` discovery for project commands, package-manager pinning, and supported global layouts. Dependency inspection also reads two-document pnpm 12 lockfiles.
- **Performance & Diagnostics:**
  - Bounded parallel `git.status` probing across project owners in `FileOps` target assessment (up to `GIT_PROBE_CONCURRENCY = 4`) and deduplicated initial `git.exe` lookup in `GitProbe`.
  - Distinct status and outcome labeling (`Cancelled late (exited 0)`) when cancellation arrives after a global mutation has already exited `0`, while preserving `mayHaveChanged` and inventory refresh safeguards.
- **Security & Dependency Hygiene:**
  - Moved the `shadcn` build tool to `devDependencies`, resolving the web app’s production audit finding, and updated `THIRD_PARTY_NOTICES.md`.
  - Updated `SECURITY.md`, `CONTRIBUTING.md`, issue templates, and root/app READMEs for `1.x`.

### Core Capabilities in v1.0.0

- **Scanner (`ScannerModule`):** Whole-machine or root-scoped discovery under `SCAN_ROOT_PATHS` with realpath/junction guards, system denylist protection, cancellation, and cached snapshots.
- **Projects & Dependencies (`ProjectsModule`):** Read-only manifest and lockfile analysis (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` Classic), outdated package lookups, and bulk vulnerability advisory checks.
- **Native Command Runner (`NpmRunnerModule`):** Run install/update/uninstall or declared scripts in dedicated Windows CMD or PowerShell windows with process-tree tracking, recovery hold, and project-command trust safeguards.
- **Disk Usage & Safe Cleanup (`DiskUsageModule`, `FileOpsModule`):** Lazy directory size inspection and bulk `node_modules`/build-cache cleanup gated behind mandatory **preview → confirm → execute** with severity-based confirmation, and bounded parallel Git checks. `node_modules` and build caches are deleted permanently; project and project-content targets go to the Windows Recycle Bin, with no permanent fallback.
- **Global Packages & Package-Manager Pinning (`GlobalPackagesModule`, `PackageManagerModule`):** Preview/confirm management of global npm (`10–12`) and pnpm (`10–12`) packages (including global `npm` version change/restore/repair) and format-preserving `packageManager` manifest pinning.
- **Web UI (`@pkgsteward/web`):** Next.js 16 App Router workspace with light/dark themes (WCAG AA contrast), Vietnamese/English i18n (`next-intl`), disabled-reason tooltips, URL- and session-persisted workspace filters, and a development-only `/design-system`.

## [0.2.4-alpha] - 2026-11-16

- Native Windows CMD / PowerShell project terminal runner with persistent shell window & recovery hold (replacing the embedded terminal), bounded checkbox filter popovers, and workspace-wide FE UX overhaul across Home/Projects, Disk Usage, Project Detail, Files, Global Packages, `/cleanup` presets, WCAG AA warning tokens, and disabled-reason tooltips.

## [0.2.3-alpha] - 2026-11-16

- Cross-route navigation state continuity, list discovery/search/filter controls, initial embedded project terminal dock, and root script / i18n validation fixes.

## [0.2.2-alpha] - 2026-11-16

- `PackageManagerModule` manifest pinning, `npm 12` / `npm 10` / `pnpm 10` / `Node 22.18+` support, global `npm` version change/restore/repair, root `dev`/`build`/`start` & browser auto-open, project list filters, Yarn Classic lockfile/root support, active job resumption, and PkgSteward logo.

## [0.2.1-alpha] - 2026-11-09

- Documentation fixes (`NestJS 12`, Vietnamese README timeout defaults) and clean E2E test cache-flush logging.

## [0.2.0-alpha] - 2026-11-09

- Added `ProjectsModule`, `NpmRunnerModule`, `GlobalPackagesModule` (npm 11 + pnpm 11), monorepo `apps/api` + `apps/web` layout, root install script, CodeQL security fixes, and `THIRD_PARTY_NOTICES.md`.

## [0.1.0-alpha] - 2026-11-01

- Initial alpha release with Host/Origin safety foundation, `ScannerModule`, `DiskUsageModule`, and `FileOpsModule` (`node_modules` and build-cache cleanup).

[1.0.0]: https://github.com/LienThuan04/PkgSteward/compare/v0.2.4-alpha...v1.0.0
[0.2.4-alpha]: https://github.com/LienThuan04/PkgSteward/compare/v0.2.3-alpha...v0.2.4-alpha
[0.2.3-alpha]: https://github.com/LienThuan04/PkgSteward/compare/v0.2.2-alpha...v0.2.3-alpha
[0.2.2-alpha]: https://github.com/LienThuan04/PkgSteward/compare/v0.2.1-alpha...v0.2.2-alpha
[0.2.1-alpha]: https://github.com/LienThuan04/PkgSteward/compare/v0.2.0-alpha...v0.2.1-alpha
[0.2.0-alpha]: https://github.com/LienThuan04/PkgSteward/compare/v0.1.0-alpha...v0.2.0-alpha
[0.1.0-alpha]: https://github.com/LienThuan04/PkgSteward/releases/tag/v0.1.0-alpha
