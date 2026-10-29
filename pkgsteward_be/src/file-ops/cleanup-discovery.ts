import {
  isSameOrInside,
  pathApi,
  toComparable,
  type PathPlatform,
} from '@/common/utils/path.util';
import {
  BUILD_CACHE_DIR_NAMES,
  matchBuildCacheName,
  type BuildCacheDirName,
} from '@/file-ops/file-ops-targets';
import type {
  CleanupKind,
  IFileOpsFs,
  IFileOpsDirent,
  IGitProbe,
} from '@/file-ops/interfaces/file-ops.types';
import type { IStoredScanResult } from '@/scanner/interfaces/scanner.types';

export const FRAMEWORK_MARKERS: Readonly<
  Record<BuildCacheDirName, readonly string[]>
> = {
  '.next': ['next'],
  '.nuxt': ['nuxt'],
  '.svelte-kit': ['@sveltejs/kit'],
  '.turbo': ['turbo'],
  '.parcel-cache': ['parcel', '@parcel/core'],
  '.angular': ['@angular/cli', '@angular/core'],
  coverage: ['jest', 'vitest', 'nyc', 'c8', '@vitest/coverage-*'],
  '.nyc_output': ['jest', 'vitest', 'nyc', 'c8', '@vitest/coverage-*'],
};

export interface ICleanupCandidate {
  path: string;
  kind: CleanupKind;
  ownerPath: string | null;
  frameworkVerified: boolean | null;
  trackedCheck: 'clean' | 'not_repo' | 'unknown' | null;
}

export interface ICleanupDiscoveryOptions {
  includeKinds: readonly CleanupKind[];
  projectPaths?: readonly string[];
}

export interface ICleanupDiscoveryDeps {
  platform: PathPlatform;
  fs: IFileOpsFs;
  git: Pick<IGitProbe, 'trackedNames'>;
  signal: AbortSignal;
}

export async function discoverCleanupCandidates(
  scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'>,
  options: ICleanupDiscoveryOptions,
  deps: ICleanupDiscoveryDeps,
): Promise<ICleanupCandidate[]> {
  const { platform, fs, git, signal } = deps;
  signal.throwIfAborted();
  const kinds = new Set(options.includeKinds);
  if (kinds.size === 0) return [];
  const api = pathApi(platform);
  const projects = scan.projects.map((project) => ({
    project,
    key: toComparable(project.path, platform),
  }));
  const selectedKeys =
    options.projectPaths === undefined
      ? null
      : new Set(options.projectPaths.map((p) => toComparable(p, platform)));
  const selectedProjects = projects.filter(
    ({ key }) => selectedKeys === null || selectedKeys.has(key),
  );
  const candidates: ICleanupCandidate[] = [];
  const isOrdinaryDirectory = async (p: string): Promise<boolean> => {
    try {
      const stats = await fs.lstat(p);
      signal.throwIfAborted();
      return stats.isDirectory() && !stats.isSymbolicLink();
    } catch {
      signal.throwIfAborted();
      return false;
    }
  };

  for (const { project } of selectedProjects) {
    signal.throwIfAborted();
    if (
      kinds.has('node_modules') &&
      (await isOrdinaryDirectory(project.nodeModules.path))
    ) {
      candidates.push({
        path: project.nodeModules.path,
        kind: 'node_modules',
        ownerPath: project.path,
        frameworkVerified: null,
        trackedCheck: null,
      });
    }
    if (!kinds.has('build_cache')) continue;
    let entries: IFileOpsDirent[];
    try {
      entries = await fs.readdir(project.path);
      signal.throwIfAborted();
    } catch {
      signal.throwIfAborted();
      continue;
    }
    // Retain the name on disk (including casing), but sort by the approved policy.
    const cacheEntries = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => ({
        name: entry.name,
        cacheName: matchBuildCacheName(entry.name, platform),
      }));
    const ordered = BUILD_CACHE_DIR_NAMES.flatMap((name) =>
      cacheEntries
        .filter((entry) => entry.cacheName === name)
        .map((entry) => ({ name: entry.name, cacheName: name })),
    );
    if (ordered.length === 0) continue;
    const tracked = await git.trackedNames(
      project.path,
      ordered.map((entry) => entry.name),
      signal,
    );
    signal.throwIfAborted();
    const excludedNames = new Set(
      tracked.state === 'ok' ? tracked.tracked : [],
    );
    const remaining = ordered.filter((entry) => !excludedNames.has(entry.name));
    if (remaining.length === 0) continue;

    const frameworks = await verifyFrameworks(
      project.path,
      remaining.map((entry) => entry.cacheName),
      deps,
    );
    for (const entry of remaining) {
      candidates.push({
        path: api.join(project.path, entry.name),
        kind: 'build_cache',
        ownerPath: project.path,
        frameworkVerified: frameworks.get(entry.cacheName)!,
        trackedCheck: tracked.state === 'ok' ? 'clean' : tracked.state,
      });
    }
  }

  if (kinds.has('orphan_node_modules')) {
    for (const orphan of scan.orphanNodeModules) {
      signal.throwIfAborted();
      const key = toComparable(orphan.path, platform);
      if (
        selectedKeys !== null &&
        !selectedProjects.some((entry) =>
          isSameOrInside(key, entry.key, platform),
        )
      )
        continue;
      if (!(await isOrdinaryDirectory(orphan.path))) continue;
      try {
        await fs.lstat(api.join(api.dirname(orphan.path), 'package.json'));
        signal.throwIfAborted();
        continue;
      } catch (error) {
        signal.throwIfAborted();
        const code =
          error !== null && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') continue;
      }
      // Ownership is based on the full scan, even if only an ancestor was selected.
      let owner: (typeof projects)[number] | undefined;
      for (const entry of projects) {
        if (
          isSameOrInside(key, entry.key, platform) &&
          (!owner || entry.key.length > owner.key.length)
        )
          owner = entry;
      }
      candidates.push({
        path: orphan.path,
        kind: 'orphan_node_modules',
        ownerPath: owner?.project.path ?? null,
        frameworkVerified: null,
        trackedCheck: null,
      });
    }
  }
  return candidates;
}

/** Verify all cache names for an owner with one manifest read. */
export async function verifyFrameworks(
  projectPath: string,
  cacheNames: readonly BuildCacheDirName[],
  deps: Pick<ICleanupDiscoveryDeps, 'platform' | 'fs' | 'signal'>,
): Promise<Map<BuildCacheDirName, boolean>> {
  const { platform, fs, signal } = deps;
  const dependencyNames = new Set<string>();
  try {
    const content = await fs.readFile(
      pathApi(platform).join(projectPath, 'package.json'),
    );
    signal.throwIfAborted();
    const manifest: unknown = JSON.parse(content.replace(/^\uFEFF/, ''));
    if (isRecord(manifest)) {
      for (const section of [manifest.dependencies, manifest.devDependencies]) {
        if (isRecord(section))
          for (const name of Object.keys(section)) dependencyNames.add(name);
      }
    }
  } catch {
    signal.throwIfAborted();
    // An unreadable or malformed manifest leaves each candidate unverified.
  }
  return new Map(
    cacheNames.map((cacheName) => [
      cacheName,
      FRAMEWORK_MARKERS[cacheName].some((marker) =>
        marker.endsWith('-*')
          ? [...dependencyNames].some((name) =>
              name.startsWith(marker.slice(0, -1)),
            )
          : dependencyNames.has(marker),
      ),
    ]),
  );
}

// JSON.parse can also produce arrays and primitives; only object maps contain dependencies.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
