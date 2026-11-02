import type {
  ILockInventory,
  ILockPackage,
  IManifestInput,
} from '@/projects/interfaces/projects.types';
import {
  emptyInventory,
  isLocalWorkspaceSpec,
  isLockedVersion,
  isProjectRecord,
  isRegistryPackageName,
  jsonDepthWithinLimit,
  normalizeInventory,
  partialInventory,
  PROJECT_LOCK_BYTES,
  PROJECT_LOCK_RECORDS,
  registrySourceName,
  registryTarget,
  rootSpecsMatch,
  unavailableInventory,
  versionMatchesTarget,
  yieldProjectBatch,
} from '@/projects/project-lock-common';

export async function readNpmLock(
  text: string,
  manifest: IManifestInput,
  signal: AbortSignal,
): Promise<ILockInventory> {
  signal.throwIfAborted();
  if (Buffer.byteLength(text) > PROJECT_LOCK_BYTES)
    return unavailableInventory('LIMIT_EXCEEDED');
  if (!jsonDepthWithinLimit(text))
    return unavailableInventory('INVALID_LOCKFILE');
  await yieldProjectBatch(signal);
  let lock: unknown;
  try {
    lock = JSON.parse(text) as unknown;
  } catch {
    return unavailableInventory('INVALID_LOCKFILE');
  }
  signal.throwIfAborted();
  if (!isProjectRecord(lock) || !Object.hasOwn(lock, 'lockfileVersion'))
    return unavailableInventory('INVALID_LOCKFILE');
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3)
    return unavailableInventory('UNSUPPORTED_LOCKFILE');
  if (!isProjectRecord(lock.packages))
    return unavailableInventory('INVALID_LOCKFILE');
  const packages = lock.packages;
  if (!rootSpecsMatch(packages[''], manifest))
    return unavailableInventory('LOCKFILE_MISMATCH');
  const keys = Object.keys(packages).filter((key) => key !== '');
  if (keys.length > PROJECT_LOCK_RECORDS)
    return unavailableInventory('LIMIT_EXCEEDED');
  const result = emptyInventory();
  const byLocation = new Map<string, ILockPackage>();
  for (let index = 0; index < keys.length; index++) {
    if (index % 256 === 0) await yieldProjectBatch(signal);
    const location = keys[index];
    const entry = packages[location];
    if (
      !/(?:^|\/)node_modules\//.test(location) ||
      (isProjectRecord(entry) && entry.link === true)
    )
      continue;
    const inferred = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(
      location,
    )?.[1];
    if (
      !inferred ||
      !isRegistryPackageName(inferred) ||
      location.includes('\\') ||
      location.split('/').includes('..') ||
      !isProjectRecord(entry) ||
      !isLockedVersion(entry.version)
    ) {
      partialInventory(result);
      continue;
    }
    const name =
      entry.inBundle === true ? inferred : registrySourceName(entry.resolved);
    if (
      !name ||
      (entry.inBundle !== true &&
        entry.name !== undefined &&
        (typeof entry.name !== 'string' || entry.name !== name))
    ) {
      partialInventory(result);
      continue;
    }
    const normalized = { name, version: entry.version, direct: false };
    result.packages.push(normalized);
    byLocation.set(location, normalized);
  }
  for (let index = 0; index < manifest.dependencies.length; index++) {
    if (index % 256 === 0) await yieldProjectBatch(signal);
    const dependency = manifest.dependencies[index];
    const rawEntry = packages[`node_modules/${dependency.name}`];
    const resolved = byLocation.get(`node_modules/${dependency.name}`);
    const versions: string[] = [];
    for (const declaration of dependency.declarations) {
      if (isLocalWorkspaceSpec(declaration.spec)) continue;
      const target = registryTarget(dependency.name, declaration.spec);
      if (
        target.registryName &&
        isProjectRecord(rawEntry) &&
        rawEntry.link === true
      )
        continue;
      if (
        !target.registryName ||
        !resolved ||
        resolved.name !== target.registryName
      ) {
        partialInventory(result);
        continue;
      }
      if (!versionMatchesTarget(resolved.version, target))
        return unavailableInventory('LOCKFILE_MISMATCH');
      versions.push(resolved.version);
    }
    if (versions.length) result.direct.set(dependency.name, versions);
  }
  signal.throwIfAborted();
  return normalizeInventory(result, manifest);
}
