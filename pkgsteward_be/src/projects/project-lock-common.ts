import * as semver from 'semver';
import type {
  DependencyGroup,
  ILockInventory,
  ILockPackage,
  IManifestInput,
  IProjectOutdatedTarget,
  ProjectAnalysisCode,
} from '@/projects/interfaces/projects.types';

export const PROJECT_LOCK_BYTES = 32 * 1024 * 1024;
export const PROJECT_LOCK_RECORDS = 50_000;
export const isLocalWorkspaceSpec = (spec: string): boolean =>
  spec.startsWith('workspace:') || spec.startsWith('link:');
export const PROJECT_DEPENDENCY_GROUPS: readonly DependencyGroup[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

export const compareProjectText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const isProjectRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isRegistryPackageName = (value: string): boolean =>
  value.length <= 214 &&
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value);

export const isLockedVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value) &&
  semver.valid(value) !== null;

// Shared npm-registry identity rules for the three static lock adapters.
export function registryTarget(
  name: string,
  spec: string,
): IProjectOutdatedTarget {
  let registryName = name;
  let range = spec;
  if (spec.startsWith('npm:')) {
    const alias = /^npm:(@[^/]+\/[^@]+|[^@]+)@(.+)$/.exec(spec);
    if (alias) {
      registryName = alias[1];
      range = alias[2];
    } else
      return {
        name,
        registryName: null,
        spec,
        kind: 'unsupported',
        warning: 'UNSUPPORTED_SPEC',
      };
  }
  if (isRegistryPackageName(name) && isRegistryPackageName(registryName)) {
    if (semver.validRange(range) !== null) {
      return { name, registryName, spec: range, kind: 'range', warning: null };
    }
    if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(range)) {
      return { name, registryName, spec: range, kind: 'tag', warning: null };
    }
  }
  return {
    name,
    registryName: null,
    spec,
    kind: 'unsupported',
    warning: 'UNSUPPORTED_SPEC',
  };
}

export function registrySourceName(
  source: unknown,
  allowYarn = false,
): string | null {
  if (typeof source !== 'string') return null;
  try {
    const url = new URL(source);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search
    )
      return null;
    if (
      url.hostname !== 'registry.npmjs.org' &&
      !(allowYarn && url.hostname === 'registry.yarnpkg.com')
    )
      return null;
    const pathname = decodeURIComponent(url.pathname);
    const separator = pathname.indexOf('/-/');
    const name = pathname.slice(1, separator);
    return separator > 1 && isRegistryPackageName(name) ? name : null;
  } catch {
    return null;
  }
}

export function unavailableInventory(
  code: ProjectAnalysisCode,
): ILockInventory {
  return {
    coverage: 'unavailable',
    direct: new Map(),
    packages: [],
    warningCodes: [code],
    failureCode: code,
  };
}

export function emptyInventory(): ILockInventory {
  return {
    coverage: 'complete',
    direct: new Map(),
    packages: [],
    warningCodes: [],
    failureCode: null,
  };
}

export function partialInventory(
  result: ILockInventory,
  code: ProjectAnalysisCode = 'UNSUPPORTED_SPEC',
): void {
  if (result.coverage === 'complete') result.coverage = 'partial';
  if (!result.warningCodes.includes(code)) result.warningCodes.push(code);
}

export async function yieldProjectBatch(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve) => setImmediate(resolve));
  signal.throwIfAborted();
}

// Check depth before JSON.parse; quoted braces never change nesting.
export function jsonDepthWithinLimit(text: string): boolean {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > 100) return false;
    } else if (character === '}' || character === ']') depth--;
  }
  return true;
}

export function rootSpecsMatch(
  root: unknown,
  manifest: IManifestInput,
  pnpm = false,
): boolean {
  if (!isProjectRecord(root)) return false;
  for (const group of PROJECT_DEPENDENCY_GROUPS) {
    const expected = new Map<string, string>();
    for (const dependency of manifest.dependencies) {
      for (const declaration of dependency.declarations) {
        if (declaration.group === group)
          expected.set(dependency.name, declaration.spec);
      }
    }
    const actual: unknown = root[group] ?? {};
    if (
      !isProjectRecord(actual) ||
      Object.keys(actual).length !== expected.size
    )
      return false;
    for (const [name, spec] of expected) {
      if (!Object.hasOwn(actual, name)) return false;
      const value = actual[name];
      if ((pnpm && isProjectRecord(value) ? value.specifier : value) !== spec)
        return false;
    }
  }
  return true;
}

export function directRegistryNames(manifest: IManifestInput): Set<string> {
  const names = new Set<string>();
  for (const dependency of manifest.dependencies) {
    for (const declaration of dependency.declarations) {
      const target = registryTarget(dependency.name, declaration.spec);
      if (target.registryName) names.add(target.registryName);
    }
  }
  return names;
}

export function normalizeInventory(
  result: ILockInventory,
  manifest: IManifestInput,
): ILockInventory {
  const directNames = directRegistryNames(manifest);
  const unique = new Map<string, ILockPackage>();
  for (const entry of result.packages) {
    unique.set(`${entry.name}\0${entry.version}`, {
      ...entry,
      direct: directNames.has(entry.name),
    });
  }
  result.packages = [...unique.values()].sort(
    (a, b) =>
      compareProjectText(a.name, b.name) ||
      compareProjectText(a.version, b.version),
  );
  result.direct = new Map<string, string[]>(
    [...result.direct]
      .sort(([a], [b]) => compareProjectText(a, b))
      .map(([name, versions]): [string, string[]] => [
        name,
        [...new Set(versions)].sort(compareProjectText),
      ]),
  );
  result.warningCodes.sort(compareProjectText);
  return result;
}

export function versionMatchesTarget(
  version: string,
  target: IProjectOutdatedTarget,
): boolean {
  return target.kind !== 'range' || semver.satisfies(version, target.spec);
}

// Preflight block/flow depth before the parser builds its AST. Conservative
// rejection is preferable to accepting a format whose depth cannot be bounded.
export function yamlDepthWithinLimit(text: string): boolean {
  const indents: number[] = [];
  let flow = 0;
  let quote = '';
  let escaped = false;
  for (const line of text.split(/\r?\n/)) {
    if (!quote && /^\s*(?:#.*)?$/.test(line)) continue;
    const leading = /^\s*/.exec(line)?.[0] ?? '';
    if (leading.includes('\t')) return false;
    const indent = leading.length;
    while (indents.length && indents[indents.length - 1] > indent)
      indents.pop();
    if (!indents.length || indents[indents.length - 1] < indent)
      indents.push(indent);
    if (indents.length + flow > 100) return false;
    for (let index = leading.length; index < line.length; index++) {
      const character = line[index];
      if (quote) {
        if (quote === '"' && escaped) escaped = false;
        else if (quote === '"' && character === '\\') escaped = true;
        else if (character === quote) {
          if (quote === "'" && line[index + 1] === "'") index++;
          else quote = '';
        }
      } else if (
        character === '#' &&
        (index === 0 || /\s/.test(line[index - 1]))
      )
        break;
      else if (character === '"' || character === "'") quote = character;
      else if (character === '[' || character === '{') {
        if (++flow + indents.length > 100) return false;
      } else if (character === ']' || character === '}')
        flow = Math.max(0, flow - 1);
    }
  }
  return true;
}
