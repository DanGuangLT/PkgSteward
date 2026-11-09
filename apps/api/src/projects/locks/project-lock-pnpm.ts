import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
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
  normalizeInventory,
  partialInventory,
  PROJECT_LOCK_BYTES,
  PROJECT_LOCK_RECORDS,
  registrySourceName,
  registryTarget,
  rootSpecsMatch,
  unavailableInventory,
  versionMatchesTarget,
  yamlDepthWithinLimit,
  yieldProjectBatch,
} from '@/projects/locks/project-lock-common';

function safeYamlTree(root: unknown): boolean {
  const pending: { node: unknown; depth: number }[] = [
    { node: root, depth: 1 },
  ];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 100 || isAlias(item.node)) return false;
    if (isMap(item.node)) {
      if (item.node.tag) return false;
      for (const pair of item.node.items) {
        if (
          !isScalar(pair.key) ||
          typeof pair.key.value !== 'string' ||
          pair.key.tag ||
          ['__proto__', 'constructor', 'prototype', '<<'].includes(
            pair.key.value,
          )
        )
          return false;
        pending.push({ node: pair.value, depth: item.depth + 1 });
      }
    } else if (isSeq(item.node)) {
      if (item.node.tag) return false;
      for (const node of item.node.items)
        pending.push({ node, depth: item.depth + 1 });
    } else if (isScalar(item.node) && item.node.tag) return false;
  }
  return true;
}

const packageIdentity = (
  key: string,
): { name: string; version: string } | null => {
  const matched = /^(@[^/]+\/[^@]+|[^@]+)@(.+)$/.exec(key);
  if (
    !matched ||
    !isRegistryPackageName(matched[1]) ||
    !isLockedVersion(matched[2])
  )
    return null;
  return { name: matched[1], version: matched[2] };
};

function directReference(
  reference: unknown,
  name: string,
): { name: string; version: string } | null {
  if (typeof reference !== 'string') return null;
  const withoutPeers = reference.split('(')[0];
  if (isLockedVersion(withoutPeers)) return { name, version: withoutPeers };
  return packageIdentity(withoutPeers);
}

export async function readPnpmLock(
  text: string,
  manifest: IManifestInput,
  signal: AbortSignal,
): Promise<ILockInventory> {
  signal.throwIfAborted();
  if (Buffer.byteLength(text) > PROJECT_LOCK_BYTES)
    return unavailableInventory('LIMIT_EXCEEDED');
  if (!yamlDepthWithinLimit(text))
    return unavailableInventory('INVALID_LOCKFILE');
  await yieldProjectBatch(signal);
  let lock: unknown;
  try {
    const document = parseDocument(text, {
      schema: 'core',
      uniqueKeys: true,
      merge: false,
      strict: true,
      customTags: [],
    });
    if (
      document.errors.length ||
      document.warnings.length ||
      !safeYamlTree(document.contents)
    )
      return unavailableInventory('INVALID_LOCKFILE');
    lock = document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch {
    return unavailableInventory('INVALID_LOCKFILE');
  }
  signal.throwIfAborted();
  if (!isProjectRecord(lock) || !Object.hasOwn(lock, 'lockfileVersion'))
    return unavailableInventory('INVALID_LOCKFILE');
  if (lock.lockfileVersion !== '9.0' && lock.lockfileVersion !== 9)
    return unavailableInventory('UNSUPPORTED_LOCKFILE');
  if (!isProjectRecord(lock.importers) || !isProjectRecord(lock.packages))
    return unavailableInventory('INVALID_LOCKFILE');
  const root = lock.importers['.'];
  if (!rootSpecsMatch(root, manifest, true) || !isProjectRecord(root))
    return unavailableInventory('LOCKFILE_MISMATCH');
  const keys = Object.keys(lock.packages);
  if (keys.length > PROJECT_LOCK_RECORDS)
    return unavailableInventory('LIMIT_EXCEEDED');
  const result = emptyInventory();
  const pairs = new Map<string, ILockPackage>();
  for (let index = 0; index < keys.length; index++) {
    if (index % 256 === 0) await yieldProjectBatch(signal);
    const localReference = /^(@[^/]+\/[^@]+|[^@]+)@(.+)$/.exec(keys[index]);
    if (
      isLocalWorkspaceSpec(keys[index]) ||
      (localReference && isLocalWorkspaceSpec(localReference[2]))
    )
      continue;
    const identity = packageIdentity(keys[index]);
    const value = lock.packages[keys[index]];
    if (
      !identity ||
      !isProjectRecord(value) ||
      !isProjectRecord(value.resolution)
    ) {
      partialInventory(result);
      continue;
    }
    const resolution = value.resolution;
    const sourceName = registrySourceName(resolution.tarball);
    if (
      (resolution.tarball !== undefined && sourceName !== identity.name) ||
      resolution.directory !== undefined ||
      resolution.repo !== undefined ||
      resolution.type !== undefined ||
      (resolution.tarball === undefined &&
        (typeof resolution.integrity !== 'string' || !resolution.integrity))
    ) {
      partialInventory(result);
      continue;
    }
    const entry = { ...identity, direct: false };
    result.packages.push(entry);
    pairs.set(`${entry.name}\0${entry.version}`, entry);
  }
  for (let index = 0; index < manifest.dependencies.length; index++) {
    if (index % 256 === 0) await yieldProjectBatch(signal);
    const dependency = manifest.dependencies[index];
    const versions: string[] = [];
    for (const declaration of dependency.declarations) {
      if (isLocalWorkspaceSpec(declaration.spec)) continue;
      const target = registryTarget(dependency.name, declaration.spec);
      const peer = declaration.group === 'peerDependencies';
      const group = root[peer ? 'dependencies' : declaration.group];
      const declarationValue = isProjectRecord(group)
        ? group[dependency.name]
        : null;
      if (
        peer &&
        (!isProjectRecord(declarationValue) ||
          declarationValue.specifier !== declaration.spec)
      )
        continue;
      if (
        target.registryName &&
        isProjectRecord(declarationValue) &&
        typeof declarationValue.version === 'string' &&
        isLocalWorkspaceSpec(declarationValue.version)
      )
        continue;
      const resolved = directReference(
        isProjectRecord(declarationValue) ? declarationValue.version : null,
        target.registryName ?? '',
      );
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
      if (!pairs.has(`${resolved.name}\0${resolved.version}`)) {
        partialInventory(result);
        continue;
      }
      versions.push(resolved.version);
    }
    if (versions.length) result.direct.set(dependency.name, versions);
  }
  signal.throwIfAborted();
  return normalizeInventory(result, manifest);
}
