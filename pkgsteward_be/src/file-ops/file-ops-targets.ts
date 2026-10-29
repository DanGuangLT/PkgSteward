import {
  isSameOrInside,
  pathApi,
  toComparable,
  type PathPlatform,
} from '@/common/utils/path.util';
import type { PathCheckResult } from '@/core/path-guard/interfaces/path-guard.types';
import type {
  FileOpsKind,
  FileOpsMethod,
  IClassifiedTarget,
  IFileOpsFs,
  IFileOpsStat,
  TargetFailureCode,
} from '@/file-ops/interfaces/file-ops.types';
import type { IStoredScanResult } from '@/scanner/interfaces/scanner.types';

export const BUILD_CACHE_DIR_NAMES = [
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.angular',
  'coverage',
  '.nyc_output',
] as const;

export type BuildCacheDirName = (typeof BUILD_CACHE_DIR_NAMES)[number];

export function methodForKind(kind: FileOpsKind): FileOpsMethod {
  switch (kind) {
    case 'project':
    case 'project_content':
      return 'recycle';
    case 'node_modules':
    case 'orphan_node_modules':
    case 'build_cache':
      return 'permanent';
  }
}

export function matchBuildCacheName(
  name: string,
  platform: PathPlatform,
): BuildCacheDirName | null {
  const comparableName = platform === 'win32' ? name.toLowerCase() : name;
  return (
    BUILD_CACHE_DIR_NAMES.find((candidate) => candidate === comparableName) ??
    null
  );
}

export interface IClassifyDeps {
  platform: PathPlatform;
  fs: Pick<IFileOpsFs, 'lstat'>;
}

export async function classifyTargets(
  inputPaths: readonly string[],
  checks: readonly PathCheckResult[],
  scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'>,
  deps: IClassifyDeps,
): Promise<IClassifiedTarget[]> {
  if (checks.length !== inputPaths.length) {
    throw new Error('Path checks must match the number of input paths');
  }
  const { platform, fs } = deps;
  const api = pathApi(platform);
  const projects = scan.projects.map((project) => ({
    project,
    key: toComparable(project.path, platform),
  }));
  const orphanKeys = new Set(
    scan.orphanNodeModules.map((orphan) => toComparable(orphan.path, platform)),
  );
  type ProjectEntry = (typeof projects)[number];
  const nearestOwner = (key: string): ProjectEntry | undefined => {
    let nearest: ProjectEntry | undefined;
    for (const entry of projects) {
      if (
        isSameOrInside(key, entry.key, platform) &&
        (!nearest || entry.key.length > nearest.key.length)
      )
        nearest = entry;
    }
    return nearest;
  };
  // D12 is fresh for each call, shared only by targets in this batch.
  const ownerChecks = new Map<string, TargetFailureCode | null>();
  const checkOwner = async (
    owner: ProjectEntry,
  ): Promise<TargetFailureCode | null> => {
    const cached = ownerChecks.get(owner.key);
    if (cached !== undefined) return cached;
    let failure: TargetFailureCode | null = null;
    try {
      const stats = await fs.lstat(
        api.join(owner.project.path, 'package.json'),
      );
      if (!stats.isFile() || stats.isSymbolicLink())
        failure = 'PROJECT_CHANGED';
    } catch (error) {
      failure =
        errorCode(error) === 'ENOENT' ? 'PROJECT_CHANGED' : 'STAT_FAILED';
    }
    ownerChecks.set(owner.key, failure);
    return failure;
  };
  const classifyOne = async (
    inputPath: string,
    check: PathCheckResult,
  ): Promise<IClassifiedTarget> => {
    if (!check.allowed) return invalidTarget(inputPath, inputPath, check.code);
    if (check.path.isSymbolicLink)
      return invalidTarget(inputPath, check.path.resolvedPath, 'IS_LINK');

    const targetPath = check.path.realPath;
    const key = toComparable(targetPath, platform);
    let stats: IFileOpsStat;
    try {
      stats = await fs.lstat(targetPath);
    } catch (error) {
      const code = errorCode(error);
      return invalidTarget(
        inputPath,
        targetPath,
        code === 'ENOENT' || code === 'ENOTDIR' ? 'NOT_FOUND' : 'STAT_FAILED',
      );
    }
    if (stats.isSymbolicLink())
      return invalidTarget(inputPath, targetPath, 'IS_LINK');
    if (!stats.isFile() && !stats.isDirectory())
      return invalidTarget(inputPath, targetPath, 'UNSUPPORTED_TYPE');

    let owner = projects.find((entry) => entry.key === key);
    let kind: FileOpsKind;
    if (owner) {
      if (!stats.isDirectory())
        return invalidTarget(
          inputPath,
          targetPath,
          'PROJECT_CHANGED',
          owner.project,
        );
      kind = 'project';
    } else if (orphanKeys.has(key)) {
      owner = nearestOwner(key);
      if (!stats.isDirectory())
        return invalidTarget(
          inputPath,
          targetPath,
          'NOT_ORPHAN',
          owner?.project,
        );
      try {
        await fs.lstat(api.join(api.dirname(targetPath), 'package.json'));
        return invalidTarget(
          inputPath,
          targetPath,
          'NOT_ORPHAN',
          owner?.project,
        );
      } catch (error) {
        const code = errorCode(error);
        if (code !== 'ENOENT' && code !== 'ENOTDIR')
          return invalidTarget(
            inputPath,
            targetPath,
            'STAT_FAILED',
            owner?.project,
          );
      }
      kind = 'orphan_node_modules';
    } else {
      owner = nearestOwner(key);
      if (!owner)
        return invalidTarget(inputPath, targetPath, 'OUTSIDE_SCANNED_PROJECT');
      if (
        stats.isDirectory() &&
        key === toComparable(owner.project.nodeModules.path, platform)
      ) {
        kind = 'node_modules';
      } else if (
        stats.isDirectory() &&
        api.dirname(key) === owner.key &&
        matchBuildCacheName(api.basename(targetPath), platform)
      ) {
        kind = 'build_cache';
      } else {
        kind = 'project_content';
      }
    }
    if (kind !== 'orphan_node_modules' && owner) {
      const failure = await checkOwner(owner);
      if (failure)
        return invalidTarget(inputPath, targetPath, failure, owner.project);
    }
    return {
      inputPath,
      path: targetPath,
      kind,
      method: methodForKind(kind),
      valid: true,
      failureCode: null,
      owner: owner
        ? { path: owner.project.path, name: owner.project.name }
        : null,
      nestedProjects: projects
        .filter(
          (entry) =>
            entry.key !== key && isSameOrInside(entry.key, key, platform),
        )
        .map((entry) => entry.project.path),
      identity: {
        dev: stats.dev.toString(),
        ino: stats.ino.toString(),
        type: stats.isDirectory() ? 'directory' : 'file',
      },
    };
  };

  const validKeys = new Set<string>();
  const invalidInputs = new Set<string>();
  const classified: { target: IClassifiedTarget; key: string | null }[] = [];
  for (let index = 0; index < inputPaths.length; index++) {
    const target = await classifyOne(inputPaths[index], checks[index]);
    const key = target.valid ? toComparable(target.path, platform) : null;
    if (key !== null) {
      if (validKeys.has(key)) continue;
      validKeys.add(key);
    } else {
      if (invalidInputs.has(target.inputPath)) continue;
      invalidInputs.add(target.inputPath);
    }
    classified.push({ target, key });
  }
  const ancestors = [...validKeys];
  return classified
    .filter(
      ({ key }) =>
        key === null ||
        !ancestors.some(
          (ancestor) =>
            ancestor !== key && isSameOrInside(key, ancestor, platform),
        ),
    )
    .map(({ target }) => target);
}

const errorCode = (error: unknown): unknown =>
  error !== null && typeof error === 'object' && 'code' in error
    ? error.code
    : undefined;

const invalidTarget = (
  inputPath: string,
  path: string,
  failureCode: TargetFailureCode,
  owner: IClassifiedTarget['owner'] = null,
): IClassifiedTarget => ({
  inputPath,
  path,
  failureCode,
  valid: false,
  kind: null,
  method: null,
  owner: owner ? { path: owner.path, name: owner.name } : null,
  nestedProjects: [],
  identity: null,
});
