import { win32, posix } from 'node:path';
import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import { assessRisk } from '@/core/risk/risk';
import type { IRisk } from '@/core/risk/interfaces/risk.types';
import type { IGlobalProtectionInput } from '@/global-packages/interfaces/global-packages.runtime';
import {
  GLOBAL_ACTIONS,
  GLOBAL_MANAGERS,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  GlobalAction,
  GlobalManager,
  GlobalReasonCode,
  GlobalWarningCode,
  IGlobalBin,
} from '@/global-packages/interfaces/global-packages.types';
import { parseRunnerPackageSpec } from '@/npm-runner/execution/runner-command';

export const GLOBAL_PROTECTED_PACKAGES = [
  'npm',
  'corepack',
  'pnpm',
  '@pnpm/exe',
  'yarn',
  '@yarnpkg/cli',
  '@yarnpkg/cli-dist',
  'pkgsteward',
] as const;
export const GLOBAL_PROTECTED_BINS = [
  'node',
  'npm',
  'npx',
  'pnpm',
  'pnpx',
  'yarn',
  'yarnpkg',
  'corepack',
  'pkgsteward',
] as const;

const fail = (reason: GlobalReasonCode, status = 403): never => {
  throw new AppException(
    status,
    'Global package policy refused the operation',
    status === 400
      ? 'VALIDATION_ERROR'
      : status === 409
        ? 'CONFLICT'
        : 'FORBIDDEN',
    { reason },
  );
};
const hasControl = (value: string): boolean =>
  Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

// semver accepts a leading v or =; mutation targets must be canonical.
const exactVersion = (value: string): semver.SemVer | null => {
  const parsed = semver.parse(value);
  if (!parsed) return null;
  const canonical =
    parsed.version + (parsed.build.length ? `+${parsed.build.join('.')}` : '');
  return value === canonical ? parsed : null;
};

export function isGlobalPackageName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return parseRunnerPackageSpec(value, false).version === null;
  } catch {
    return false;
  }
}
export function isGlobalTargetVersion(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = parseRunnerPackageSpec(`test-package@${value}`, true);
    if (parsed.version !== value) return false;
    return semver.valid(value) === null || exactVersion(value) !== null;
  } catch {
    return false;
  }
}

// Windows shims for a declared name also occupy name.cmd/name.ps1.
const binKey = (name: string): string =>
  name.toLowerCase().replace(/\.(?:cmd|ps1|exe|bat|com)$/, '');
const validBinName = (name: string): boolean =>
  name.length <= 255 &&
  /^[a-z0-9][a-z0-9._-]*$/i.test(name) &&
  !name.endsWith('.') &&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

const normalizeBin = (name: string, target: unknown): IGlobalBin => {
  if (
    !validBinName(name) ||
    typeof target !== 'string' ||
    !target ||
    target.length > 32767 ||
    hasControl(target) ||
    /[:<>"|?*]/.test(target)
  )
    return fail('BIN_CONFLICT');
  const portable = target.replace(/\\/g, '/');
  if (
    win32.isAbsolute(target) ||
    portable.startsWith('/') ||
    portable
      .split('/')
      .some((part) => part === '..' || (/[. ]$/.test(part) && part !== '.'))
  )
    return fail('BIN_CONFLICT');
  const normalized = posix.normalize(portable);
  if (normalized === '.' || normalized.endsWith('/'))
    return fail('BIN_CONFLICT');
  return { name, target: normalized };
};

export function normalizeGlobalBins(
  packageName: string,
  value: unknown,
): IGlobalBin[] {
  if (!isGlobalPackageName(packageName))
    return fail('INVALID_PACKAGE_SPEC', 400);
  if (value === undefined) return [];
  let entries: [string, unknown][];
  if (typeof value === 'string') {
    entries = [[packageName.slice(packageName.lastIndexOf('/') + 1), value]];
  } else if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    entries = Object.entries(value);
  } else return fail('BIN_CONFLICT');
  const seen = new Set<string>();
  return entries
    .map(([name, target]) => {
      const bin = normalizeBin(name, target);
      const key = binKey(name);
      if (seen.has(key)) return fail('BIN_CONFLICT');
      seen.add(key);
      return bin;
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const canonicalPath = (value: string): string => {
  if (
    !/^[a-z]:[\\/]/i.test(value) ||
    hasControl(value) ||
    value.slice(2).includes(':') ||
    /[<>"|?*]/.test(value)
  )
    return fail('PROTECTED_PACKAGE');
  return win32.resolve(value).toLowerCase();
};
const within = (child: string, parent: string): boolean =>
  child === parent ||
  child.startsWith(parent.endsWith('\\') ? parent : `${parent}\\`);

export function assertGlobalPackageMutable(
  input: IGlobalProtectionInput,
): void {
  if (!isGlobalPackageName(input.packageName))
    return fail('INVALID_PACKAGE_SPEC', 400);
  if (GLOBAL_PROTECTED_PACKAGES.some((name) => name === input.packageName))
    return fail('PROTECTED_PACKAGE');
  if (input.linked) return fail('LINKED_PACKAGE');
  // Paths must already have been realpath/lstat checked by the location adapter.
  const root = canonicalPath(input.packageRoot);
  if (root === win32.parse(root).root) return fail('PROTECTED_PACKAGE');
  for (const protectedPath of input.protectedPaths) {
    const protectedRoot = canonicalPath(protectedPath);
    if (within(root, protectedRoot) || within(protectedRoot, root))
      return fail('PROTECTED_PACKAGE');
  }
  const bins: IGlobalBin[] = [];
  for (const declared of [input.currentBins, input.targetBins]) {
    const seen = new Set<string>();
    for (const bin of declared) {
      const normalized = normalizeBin(bin.name, bin.target);
      const key = binKey(bin.name);
      if (GLOBAL_PROTECTED_BINS.some((name) => name === key))
        return fail('PROTECTED_PACKAGE');
      if (seen.has(key)) return fail('BIN_CONFLICT');
      seen.add(key);
      bins.push(normalized);
    }
  }
  if (!input.ownershipComplete) return fail('BIN_CONFLICT');
  const owners = new Map<string, string | null>();
  for (const entry of input.binOwners) {
    if (!validBinName(entry.name)) return fail('BIN_CONFLICT');
    const key = binKey(entry.name);
    if (owners.has(key)) return fail('BIN_CONFLICT');
    owners.set(key, entry.owner);
  }
  for (const bin of bins) {
    const key = binKey(bin.name);
    if (owners.has(key) && owners.get(key) !== input.packageName)
      return fail('BIN_CONFLICT');
  }
  if (input.pnpmGroup) assertPnpmGlobalPackageMutable(input);
}

function assertPnpmGlobalPackageMutable(input: IGlobalProtectionInput): void {
  const group = input.pnpmGroup!;
  const base = { ...input, pnpmGroup: undefined, groupPackages: undefined };
  // pnpm mutates the entire install directory; its links are already proven by inventory.
  for (const packageRoot of [
    group.installDir,
    ...group.packageLinks.flatMap((link) => [link.logicalPath, link.realPath]),
  ])
    assertGlobalPackageMutable({ ...base, packageRoot });
  for (const member of input.groupPackages ?? []) {
    assertGlobalPackageMutable({
      ...base,
      packageName: member.name,
      packageRoot: member.packageRoot,
      currentBins: member.bins,
      targetBins: [],
      binOwners: [],
    });
  }
}
export function assessGlobalVersionChange(
  current: string,
  target: string,
): GlobalWarningCode[] {
  const before = exactVersion(current);
  const after = exactVersion(target);
  if (!before || !after) return fail('INVALID_PACKAGE_SPEC', 400);
  const direction = semver.compare(after, before);
  if (direction === 0) return fail('NO_VERSION_CHANGE', 409);
  const warnings: GlobalWarningCode[] = [];
  if (before.major !== after.major) warnings.push('MAJOR_VERSION_CHANGE');
  if (direction < 0) warnings.push('VERSION_DOWNGRADE');
  if (after.prerelease.length > 0) warnings.push('PRERELEASE_VERSION');
  return warnings;
}
export function getGlobalRisk(): IRisk {
  return assessRisk(['MACHINE_WIDE']);
}
export function globalConfirmText(
  manager: GlobalManager,
  action: GlobalAction,
  packageName: string,
  targetVersion: string | null,
): string {
  if (
    !GLOBAL_MANAGERS.includes(manager) ||
    !GLOBAL_ACTIONS.includes(action) ||
    !isGlobalPackageName(packageName)
  )
    return fail('INVALID_PACKAGE_SPEC', 400);
  if (action === 'remove') {
    if (targetVersion !== null) return fail('INVALID_PACKAGE_SPEC', 400);
    return `REMOVE GLOBAL ${manager} ${packageName}`;
  }
  if (targetVersion === null || !exactVersion(targetVersion))
    return fail('INVALID_PACKAGE_SPEC', 400);
  return `CHANGE GLOBAL ${manager} ${packageName} TO ${targetVersion}`;
}
