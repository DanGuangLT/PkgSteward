import { readNpmLock } from './project-lock-npm';
import type {
  ILockInventory,
  IManifestInput,
  IProjectInput,
  IProjectOutdatedTarget,
  ProjectManager,
} from './interfaces/projects.types';
import {
  compareProjectText,
  normalizeInventory,
  partialInventory,
  registryTarget,
  unavailableInventory,
  yieldProjectBatch,
} from './project-lock-common';
import { readPnpmLock } from './project-lock-pnpm';
import { readYarnLock } from './project-lock-yarn';

export async function buildProjectInventory(
  input: IProjectInput,
  signal: AbortSignal,
): Promise<ILockInventory> {
  signal.throwIfAborted();
  if (!input.lock) {
    const result = unavailableInventory(
      input.warningCodes.includes('LOCKFILE_MISMATCH') ||
        input.manager === 'ambiguous'
        ? 'LOCKFILE_MISMATCH'
        : 'NO_LOCKFILE',
    );
    result.warningCodes = [
      ...new Set([...result.warningCodes, ...input.warningCodes]),
    ].sort(compareProjectText);
    return result;
  }
  const manager: ProjectManager =
    input.lock.name === 'pnpm-lock.yaml'
      ? 'pnpm'
      : input.lock.name === 'yarn.lock'
        ? 'yarn'
        : 'npm';
  if (input.manager !== manager)
    return unavailableInventory('LOCKFILE_MISMATCH');
  const reader =
    manager === 'pnpm'
      ? readPnpmLock
      : manager === 'yarn'
        ? readYarnLock
        : readNpmLock;
  const result = await reader(input.lock.text, input.manifest, signal);
  signal.throwIfAborted();
  // Parser record limits and this deduplicated audit-pair cap are independent.
  normalizeInventory(result, input.manifest);
  if (result.packages.length > 10_000) {
    result.packages = result.packages.slice(0, 10_000);
    partialInventory(result, 'LIMIT_EXCEEDED');
  }
  result.warningCodes = [
    ...new Set([
      ...result.warningCodes,
      ...input.warningCodes,
      ...(input.registryPolicy ? [input.registryPolicy] : []),
    ]),
  ].sort(compareProjectText);
  await yieldProjectBatch(signal);
  return result;
}

export function getProjectOutdatedTargets(
  manifest: IManifestInput,
): IProjectOutdatedTarget[] {
  const unique = new Map<string, IProjectOutdatedTarget>();
  for (const dependency of manifest.dependencies) {
    for (const declaration of dependency.declarations) {
      const target = registryTarget(dependency.name, declaration.spec);
      unique.set(
        JSON.stringify([
          target.name,
          target.registryName,
          target.spec,
          target.kind,
        ]),
        target,
      );
    }
  }
  return [...unique.values()].sort(
    (a, b) =>
      compareProjectText(a.name, b.name) || compareProjectText(a.spec, b.spec),
  );
}
