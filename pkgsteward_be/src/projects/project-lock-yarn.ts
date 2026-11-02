import * as classicLock from '@yarnpkg/lockfile';
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
  normalizeInventory,
  partialInventory,
  PROJECT_LOCK_BYTES,
  PROJECT_LOCK_RECORDS,
  registrySourceName,
  registryTarget,
  unavailableInventory,
  versionMatchesTarget,
  yamlDepthWithinLimit,
  yieldProjectBatch,
} from '@/projects/project-lock-common';

export async function readYarnLock(
  text: string,
  manifest: IManifestInput,
  signal: AbortSignal,
): Promise<ILockInventory> {
  signal.throwIfAborted();
  if (Buffer.byteLength(text) > PROJECT_LOCK_BYTES)
    return unavailableInventory('LIMIT_EXCEEDED');
  if (text.includes('<<<<<<<')) return unavailableInventory('INVALID_LOCKFILE');
  if (/^[ \t]*(?:__metadata|"__metadata"|'__metadata')\s*:/m.test(text))
    return unavailableInventory('UNSUPPORTED_LOCKFILE');
  if (!yamlDepthWithinLimit(text))
    return unavailableInventory('INVALID_LOCKFILE');
  await yieldProjectBatch(signal);
  // The parser's tokenizer never returns on a comment or quote left open at the
  // end of its input: it fills the heap and aborts the process. This trailer ends
  // both and reads as a comment otherwise. Its merge path drops the trailer, so
  // conflict markers are refused above.
  const boundedText = `${text}\n# "\n`;
  let parsed: unknown;
  try {
    parsed = classicLock.parse(boundedText);
  } catch {
    return unavailableInventory('INVALID_LOCKFILE');
  }
  signal.throwIfAborted();
  if (
    !isProjectRecord(parsed) ||
    parsed.type !== 'success' ||
    !isProjectRecord(parsed.object)
  ) {
    return unavailableInventory('INVALID_LOCKFILE');
  }
  const records = parsed.object;
  const headings = Object.keys(records);
  if (headings.length > PROJECT_LOCK_RECORDS)
    return unavailableInventory('LIMIT_EXCEEDED');
  const result = emptyInventory();
  const byDescriptor = new Map<string, ILockPackage>();
  for (let index = 0; index < headings.length; index++) {
    if (index % 256 === 0) await yieldProjectBatch(signal);
    const heading = headings[index];
    const descriptor = /^(@[^/]+\/[^@]+|[^@]+)@(.+)$/.exec(heading);
    if (descriptor && isLocalWorkspaceSpec(descriptor[2])) continue;
    const entry = records[heading];
    if (
      !descriptor ||
      !isProjectRecord(entry) ||
      !isLockedVersion(entry.version)
    ) {
      partialInventory(result);
      continue;
    }
    const target = registryTarget(descriptor[1], descriptor[2]);
    const name = registrySourceName(entry.resolved, true);
    if (!name || target.registryName !== name) {
      partialInventory(result);
      continue;
    }
    const normalized = { name, version: entry.version, direct: false };
    result.packages.push(normalized);
    byDescriptor.set(heading, normalized);
  }
  for (let index = 0; index < manifest.dependencies.length; index++) {
    if (index % 256 === 0) await yieldProjectBatch(signal);
    const dependency = manifest.dependencies[index];
    const versions: string[] = [];
    for (const declaration of dependency.declarations) {
      if (isLocalWorkspaceSpec(declaration.spec)) continue;
      const descriptor = `${dependency.name}@${declaration.spec}`;
      if (!Object.hasOwn(records, descriptor)) {
        if (declaration.group === 'peerDependencies') continue;
        return unavailableInventory('LOCKFILE_MISMATCH');
      }
      const resolved = byDescriptor.get(descriptor);
      const target = registryTarget(dependency.name, declaration.spec);
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
