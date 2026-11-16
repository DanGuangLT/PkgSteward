import type {
  IGlobalPreviewFacts,
  IGlobalLocation,
  IGlobalRuntime,
  IGlobalPackageFacts,
  INpmPathFacts,
  INpmSelfFacts,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalExecuteRequest,
  IGlobalPreview,
  IGlobalPreviewRequest,
} from '@/global-packages/interfaces/global-packages.types';
import type { IGlobalBin } from '@/global-packages/interfaces/global-packages.types';
import type { IRunnerFileIdentity } from '@/npm-runner/interfaces/npm-runner.types';
import { win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { assertGlobalConfigUnchanged } from '@/global-packages/config/global-config';
import {
  assessGlobalVersionChange,
  getGlobalRisk,
  globalConfirmText,
  assertGlobalRepairAction,
} from '@/global-packages/policy/global-policy';
import {
  assertNpmOverlayMutable,
  assertNpmTarget,
  npmSelfWarnings,
  npmTerminalVersion,
} from '@/global-packages/policy/npm-overlay';
import { validateConfirmation } from '@/core/risk/confirmation';
import type { IGlobalConfigIdentity } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IPnpmGlobalConfig,
  IPnpmGlobalGroupFacts,
  IPnpmGlobalLinkFacts,
} from '@/global-packages/interfaces/pnpm-global.types';

export const GLOBAL_PREVIEW_LIMIT = 16;
export const GLOBAL_PREVIEW_BYTES = 256 * 1024;
export const GLOBAL_PREVIEW_TTL_MS = 5 * 60 * 1000;

export interface IGlobalPreviewRecord {
  preview: IGlobalPreview;
  facts: IGlobalPreviewFacts;
  readyAt: number;
}

const refuse = (reason: string): never => {
  throw new AppException(409, 'Global preview cannot be used', 'CONFLICT', {
    reason,
  });
};
const pathKey = (path: string): string => win32.resolve(path).toLowerCase();
const sortBins = (bins: readonly IGlobalBin[]): IGlobalBin[] =>
  [...bins].sort((a, b) => a.name.localeCompare(b.name));
const statData = (file: IRunnerFileIdentity): Record<string, unknown> =>
  Object.fromEntries<unknown>(
    Object.entries(file.stat)
      .filter(([, value]) => typeof value !== 'function')
      .map(([key, value]) => [
        key,
        Object.prototype.toString.call(value) === '[object Date]'
          ? Number(value)
          : value,
      ]),
  );
const identityFacts = (file: IRunnerFileIdentity) => ({
  path: pathKey(file.path),
  stat: Object.fromEntries<unknown>(
    Object.entries(statData(file)).filter(
      ([key]) => !/^atime(?:ms|ns)?$/i.test(key),
    ),
  ),
});
const identities = (files: readonly IRunnerFileIdentity[]) =>
  files.map(identityFacts).sort((a, b) => a.path.localeCompare(b.path));

function snapshotIdentity(file: IRunnerFileIdentity): IRunnerFileIdentity {
  // Live reader identities share this type; retained identities use stat data only.
  const stat = statData(file) as unknown as IRunnerFileIdentity['stat'];
  return { ...file, stat };
}

// pnpm 10 has nested identities in its project, links, ancillary entries and
// bin slots. Strip stat methods before retaining a deep immutable snapshot.
function pnpm10Data(value: unknown, compare = false): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v: unknown) => pnpm10Data(v, compare));
    return compare
      ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : items;
  }
  if (value && typeof value === 'object') {
    if ('path' in value && 'stat' in value) {
      const file = value as IRunnerFileIdentity & { pnpm10Kind?: string };
      const pnpm10Kind =
        file.pnpm10Kind ??
        (file.stat.isSymbolicLink?.()
          ? 'link'
          : file.stat.isFile?.()
            ? 'file'
            : file.stat.isDirectory?.()
              ? 'directory'
              : 'other');
      return compare
        ? { ...identityFacts(file), pnpm10Kind }
        : { ...snapshotIdentity(file), pnpm10Kind };
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, v]) => [name, pnpm10Data(v, compare)]),
    );
  }
  return value;
}

function snapshotLocation(location: IGlobalLocation): IGlobalLocation {
  return {
    ...location,
    tool: {
      ...location.tool,
      identities: location.tool.identities.map(snapshotIdentity),
      ...(location.tool.npm10InstallCompatIdentities
        ? {
            npm10InstallCompatIdentities:
              location.tool.npm10InstallCompatIdentities.map(snapshotIdentity),
          }
        : {}),
    },
    configIdentities: location.configIdentities.map((identity) => ({
      ...identity,
      file: snapshotIdentity(identity.file),
    })),
    ...(location.pnpm ? { pnpm: snapshotPnpmConfig(location.pnpm) } : {}),
    ...(location.pnpm10
      ? { pnpm10: pnpm10Data(location.pnpm10) as IGlobalLocation['pnpm10'] }
      : {}),
  };
}

const snapshotConfigIdentity = (
  identity: IGlobalConfigIdentity,
): IGlobalConfigIdentity => ({
  ...identity,
  file: snapshotIdentity(identity.file),
});
const snapshotLink = (link: IPnpmGlobalLinkFacts): IPnpmGlobalLinkFacts => ({
  ...link,
  identity: snapshotIdentity(link.identity),
});
function snapshotPnpmConfig(config: IPnpmGlobalConfig): IPnpmGlobalConfig {
  return {
    ...config,
    configIdentities: config.configIdentities.map(snapshotConfigIdentity),
    directoryIdentities: config.directoryIdentities.map(snapshotIdentity),
  };
}
function snapshotGroup(group: IPnpmGlobalGroupFacts): IPnpmGlobalGroupFacts {
  return {
    ...group,
    index: snapshotLink(group.index),
    directory: snapshotIdentity(group.directory),
    manifest: snapshotConfigIdentity(group.manifest),
    lockfile: snapshotConfigIdentity(group.lockfile),
    modules: snapshotConfigIdentity(group.modules),
    packageMap: snapshotConfigIdentity(group.packageMap),
    virtualStoreLockfile: snapshotConfigIdentity(group.virtualStoreLockfile),
    packageLinks: group.packageLinks.map(snapshotLink),
  };
}

function snapshotPackage(current: IGlobalPackageFacts): IGlobalPackageFacts {
  return {
    ...current,
    manifest: snapshotConfigIdentity(current.manifest),
    binIdentities: current.binIdentities.map(snapshotIdentity),
    ...(current.pnpmGroup
      ? { pnpmGroup: snapshotGroup(current.pnpmGroup) }
      : {}),
  };
}
const snapshotNpmPath = (entry: INpmPathFacts): INpmPathFacts => ({
  ...entry,
  identity: snapshotIdentity(entry.identity),
});
function snapshotNpm(npm: INpmSelfFacts): INpmSelfFacts {
  return {
    ...npm,
    prefixDirectory: snapshotNpmPath(npm.prefixDirectory),
    rootDirectory: snapshotNpmPath(npm.rootDirectory),
    bundledIdentities: npm.bundledIdentities.map(snapshotConfigIdentity),
    prefixScript: npm.prefixScript
      ? snapshotConfigIdentity(npm.prefixScript)
      : null,
    nodeDirShims: npm.nodeDirShims.map((shim) => ({
      ...shim,
      entry: shim.entry ? snapshotNpmPath(shim.entry) : null,
    })),
    shims: npm.shims.map((shim) => ({
      ...shim,
      entry: shim.entry ? snapshotNpmPath(shim.entry) : null,
    })),
    overlay: npm.overlay
      ? {
          directory: snapshotNpmPath(npm.overlay.directory),
          package: npm.overlay.package
            ? snapshotPackage(npm.overlay.package)
            : null,
        }
      : null,
    retired: npm.retired.map(snapshotNpmPath),
    repairTargets: npm.repairTargets.map(snapshotNpmPath),
  };
}

export function snapshotGlobalPreviewFacts<T extends IGlobalPreviewFacts>(
  facts: T,
): T;
export function snapshotGlobalPreviewFacts(
  facts: IGlobalPreviewFacts,
): IGlobalPreviewFacts {
  return structuredClone({
    ...facts,
    location: snapshotLocation(facts.location),
    locations: facts.locations?.map(snapshotLocation),
    current: facts.current ? snapshotPackage(facts.current) : null,
    ...(facts.npm ? { npm: snapshotNpm(facts.npm) } : {}),
    ...(facts.pnpm10Inventory
      ? {
          pnpm10Inventory: pnpm10Data(
            facts.pnpm10Inventory,
          ) as IGlobalPreviewFacts['pnpm10Inventory'],
        }
      : {}),
    ...(facts.pnpmInventory
      ? {
          pnpmInventory: {
            ...facts.pnpmInventory,
            groups: facts.pnpmInventory.groups.map(snapshotGroup),
            unreferencedDirectories:
              facts.pnpmInventory.unreferencedDirectories.map(snapshotIdentity),
            shimIdentities: facts.pnpmInventory.shimIdentities?.map(
              snapshotConfigIdentity,
            ),
          },
        }
      : {}),
  });
}

const configIdentityFacts = (identity: IGlobalConfigIdentity) => ({
  sha256: identity.sha256,
  file: identityFacts(identity.file),
});
const pathSet = (paths: readonly string[]) => paths.map(pathKey).sort();
const linkFacts = (link: IPnpmGlobalLinkFacts) => ({
  logicalPath: pathKey(link.logicalPath),
  realPath: pathKey(link.realPath),
  identity: identityFacts(link.identity),
});
function groupFacts(group: IPnpmGlobalGroupFacts) {
  return {
    ...group,
    index: linkFacts(group.index),
    installDir: pathKey(group.installDir),
    directory: identityFacts(group.directory),
    manifest: configIdentityFacts(group.manifest),
    lockfile: configIdentityFacts(group.lockfile),
    modules: configIdentityFacts(group.modules),
    packageMap: configIdentityFacts(group.packageMap),
    virtualStoreLockfile: configIdentityFacts(group.virtualStoreLockfile),
    directDependencies: [...group.directDependencies].sort(),
    packageLinks: group.packageLinks
      .map(linkFacts)
      .sort((a, b) => a.logicalPath.localeCompare(b.logicalPath)),
    storeDir: pathKey(group.storeDir),
    virtualStoreDir: pathKey(group.virtualStoreDir),
  };
}
function pnpmConfigFacts(config: IPnpmGlobalConfig) {
  return {
    ...config,
    homeDir: pathKey(config.homeDir),
    globalDir: pathKey(config.globalDir),
    globalRoot: pathKey(config.globalRoot),
    binDir: pathKey(config.binDir),
    storeDir: config.storeDir === null ? null : pathKey(config.storeDir),
    cacheDir: pathKey(config.cacheDir),
    stateDir: pathKey(config.stateDir),
    configDir: pathKey(config.configDir),
    authFile: pathKey(config.authFile),
    originalPath: pathSet(config.originalPath),
    missingConfigPaths: pathSet(config.missingConfigPaths),
    missingDirectoryPaths: pathSet(config.missingDirectoryPaths),
    configIdentities: config.configIdentities
      .map(configIdentityFacts)
      .sort((a, b) => a.file.path.localeCompare(b.file.path)),
    directoryIdentities: identities(config.directoryIdentities),
    selectors: Object.fromEntries(
      Object.entries(config.selectors).map(([name, value]) => [
        name,
        value === undefined ? undefined : pathKey(value),
      ]),
    ),
    policy: {
      ...config.policy,
      scopedRegistries: [...config.policy.scopedRegistries].sort(),
    },
  };
}

function locationFacts(location: IGlobalLocation) {
  return {
    manager: location.manager,
    tool: {
      ...location.tool,
      file: pathKey(location.tool.file),
      entry: location.tool.entry ? pathKey(location.tool.entry) : null,
      packageDir: pathKey(location.tool.packageDir),
      identities: identities(location.tool.identities),
      ...(location.tool.npm10InstallCompatIdentities
        ? {
            npm10InstallCompatIdentities: identities(
              location.tool.npm10InstallCompatIdentities,
            ),
          }
        : {}),
    },
    paths: [
      location.prefix,
      location.globalDir,
      location.globalRoot,
      location.binDir,
      location.cacheDir,
      location.storeDir,
      location.userConfig,
      location.globalConfig,
    ].map((path) => (path === null ? null : pathKey(path))),
    config: location.configIdentities
      .map((identity) => ({
        sha256: identity.sha256,
        file: identityFacts(identity.file),
      }))
      .sort((a, b) => a.file.path.localeCompare(b.file.path)),
    pnpm: location.pnpm ? pnpmConfigFacts(location.pnpm) : undefined,
    pnpm10: location.pnpm10 ? pnpm10Data(location.pnpm10, true) : undefined,
  };
}

function packageFacts(current: IGlobalPackageFacts) {
  return {
    ...current,
    packageRoot: pathKey(current.packageRoot),
    manifest: configIdentityFacts(current.manifest),
    bins: sortBins(current.bins),
    binIdentities: identities(current.binIdentities),
    pnpmGroup: current.pnpmGroup ? groupFacts(current.pnpmGroup) : undefined,
  };
}
function npmPathFacts(entry: INpmPathFacts) {
  const stat = entry.identity.stat;
  return {
    ...entry,
    path: pathKey(entry.path),
    realPath: pathKey(entry.realPath),
    identity:
      entry.type === 'directory'
        ? {
            path: pathKey(entry.identity.path),
            dev: stat.dev,
            ino: stat.ino,
            type: entry.type,
          }
        : {
            path: pathKey(entry.identity.path),
            dev: stat.dev,
            ino: stat.ino,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ctimeMs: stat.ctimeMs,
          },
  };
}
function comparableNpm(npm: INpmSelfFacts) {
  const paths = (entries: INpmPathFacts[]) =>
    entries.map(npmPathFacts).sort((a, b) => a.path.localeCompare(b.path));
  const shims = (entries: INpmSelfFacts['shims']) =>
    entries
      .map((shim) => ({
        ...shim,
        entry: shim.entry ? npmPathFacts(shim.entry) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...npm,
    nodeDir: pathKey(npm.nodeDir),
    packageDir: pathKey(npm.packageDir),
    // Exact prefix spelling also pins the strings npm hashes for retired paths.
    prefixResolved: npm.prefixResolved,
    prefixReal: npm.prefixReal,
    protectedPaths: pathSet(npm.protectedPaths),
    prefixDirectory: npmPathFacts(npm.prefixDirectory),
    rootDirectory: npmPathFacts(npm.rootDirectory),
    bundledIdentities: npm.bundledIdentities
      .map(configIdentityFacts)
      .sort((a, b) => a.file.path.localeCompare(b.file.path)),
    prefixScript: npm.prefixScript
      ? configIdentityFacts(npm.prefixScript)
      : null,
    nodeDirShims: shims(npm.nodeDirShims),
    shims: shims(npm.shims),
    overlay: npm.overlay
      ? {
          directory: npmPathFacts(npm.overlay.directory),
          package: npm.overlay.package
            ? packageFacts(npm.overlay.package)
            : null,
        }
      : null,
    retired: paths(npm.retired),
    repairTargets: paths(npm.repairTargets),
  };
}

function comparable(facts: IGlobalPreviewFacts) {
  const { location, current, target } = facts;
  return {
    location: locationFacts(location),
    locations: facts.locations
      ?.map(locationFacts)
      .sort((a, b) => a.manager.localeCompare(b.manager)),
    current: current ? packageFacts(current) : null,
    npm: facts.npm ? comparableNpm(facts.npm) : undefined,
    pnpm10Inventory: facts.pnpm10Inventory
      ? pnpm10Data(facts.pnpm10Inventory, true)
      : undefined,
    target: target ? { ...target, bins: sortBins(target.bins) } : null,
    binOwners: [...facts.binOwners].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    registryChangeAllowed: facts.registryChangeAllowed,
    pnpmInventory: facts.pnpmInventory
      ? {
          ...facts.pnpmInventory,
          groups: facts.pnpmInventory.groups
            .map(groupFacts)
            .sort((a, b) =>
              a.index.logicalPath.localeCompare(b.index.logicalPath),
            ),
          unreferencedDirectories: identities(
            facts.pnpmInventory.unreferencedDirectories,
          ),
          shimIdentities: facts.pnpmInventory.shimIdentities
            ?.map(configIdentityFacts)
            .sort((a, b) => a.file.path.localeCompare(b.file.path)),
        }
      : undefined,
  };
}

export function createGlobalPreview(
  previewId: string,
  request: IGlobalPreviewRequest,
  facts: IGlobalPreviewFacts,
  now: Date,
): IGlobalPreview {
  const { current, target, location } = facts;
  assertGlobalRepairAction(request.manager, request.action, request.package);
  const npm = facts.npm;
  // npm itself must always carry npm facts, and only npm itself may (G1-2).
  const npmSelf = request.manager === 'npm' && request.package === 'npm';
  if (Boolean(npm) !== npmSelf || (!npm && !current))
    return refuse('PREVIEW_CHANGED');
  const packageName = npm ? 'npm' : current?.name;
  if (
    request.package !== packageName ||
    request.manager !== location.manager ||
    (request.action === 'change'
      ? !target ||
        target.name !== packageName ||
        target.requestedVersion !== request.targetVersion
      : target !== null)
  )
    return refuse('PREVIEW_CHANGED');
  const classification = npm
    ? assertNpmOverlayMutable(request.action, npm)
    : null;
  const currentVersion = npm
    ? npmTerminalVersion(npm, classification!.state)
    : current!.version;
  if (npm && target) assertNpmTarget(target, npm.nodeVersion, currentVersion);
  const terminalAfter = npm ? (target?.version ?? npm.bundledVersion) : null;
  const before = sortBins((npm ? npm.overlay?.package : current)?.bins ?? []);
  const after = sortBins(target?.bins ?? []);
  if (
    location.pnpm10 &&
    after.length > 0 &&
    facts.pnpm10Inventory?.project.missingPaths.some(
      (p) =>
        win32.resolve(p).toLowerCase() ===
        win32.resolve(location.binDir).toLowerCase(),
    )
  )
    return refuse('PNPM_GLOBAL_NOT_CONFIGURED');
  const warnings = npm
    ? npmSelfWarnings(request.action, currentVersion, terminalAfter!)
    : target
      ? assessGlobalVersionChange(current!.version, target.version)
      : [];
  const sharedPackages =
    location.pnpm10 && facts.pnpm10Inventory
      ? facts.pnpm10Inventory.project.dependencies
          .filter((d) => d.name !== packageName)
          .map(({ name, version, linked }) => ({ name, version, linked }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : undefined;
  if (sharedPackages?.length) warnings.push('PNPM_SHARED_GLOBAL_PROJECT');
  const preview: IGlobalPreview = {
    previewId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GLOBAL_PREVIEW_TTL_MS).toISOString(),
    manager: request.manager,
    managerVersion: location.tool.version,
    action: request.action,
    package: packageName,
    currentVersion,
    requestedVersion: target?.requestedVersion ?? null,
    targetVersion: target?.version ?? null,
    globalRoot: location.globalRoot,
    binDir: location.binDir,
    bins: {
      before,
      after,
      added: after.filter(
        (bin) => !before.some((old) => old.name === bin.name),
      ),
      removed: before.filter(
        (bin) => !after.some((next) => next.name === bin.name),
      ),
      replaced: before.flatMap((old) => {
        const next = after.find((bin) => bin.name === old.name);
        return next && next.target !== old.target
          ? [{ before: old, after: next }]
          : [];
      }),
    },
    // Repair xoá ngay trong process (không chạy code của gói, không spawn tiến trình con) nên
    // không có cảnh báo script vòng đời / tiến trình thoát cây (U-91).
    warningCodes:
      request.action === 'repair'
        ? [...warnings, 'GLOBAL_CONSUMERS_UNKNOWN']
        : [
            ...warnings,
            'GLOBAL_CODE_EXECUTION',
            'GLOBAL_CONSUMERS_UNKNOWN',
            'PROCESS_ESCAPE_RESIDUAL',
          ],
    risk: getGlobalRisk(),
    confirmText: globalConfirmText(
      request.manager,
      request.action,
      packageName,
      target?.version ?? null,
    ),
    ...(sharedPackages ? { sharedPackages } : {}),
    ...(npm
      ? {
          npm: {
            appVersion: npm.bundledVersion,
            terminalBefore: currentVersion,
            terminalAfter: terminalAfter!,
            prefix: location.prefix ?? npm.prefixResolved,
            repairTargets:
              request.action === 'repair'
                ? classification!.repairTargets.map((entry) => entry.path)
                : [],
          },
        }
      : {}),
  };
  return structuredClone(preview);
}

export function assertGlobalPreviewUnchanged(
  expected: IGlobalPreviewFacts,
  actual: IGlobalPreviewFacts,
): void {
  const previous = snapshotGlobalPreviewFacts(expected);
  const current = snapshotGlobalPreviewFacts(actual);
  assertGlobalConfigUnchanged(
    previous.location.configIdentities,
    current.location.configIdentities,
  );
  if (!isDeepStrictEqual(comparable(previous), comparable(current)))
    refuse('PREVIEW_CHANGED');
}

export function validateGlobalConfirmation(
  preview: IGlobalPreview,
  input: IGlobalExecuteRequest,
): void {
  validateConfirmation(
    getGlobalRisk(),
    globalConfirmText(
      preview.manager,
      preview.action,
      preview.package,
      preview.targetVersion,
    ),
    input,
  );
}

export class GlobalPreviewStore {
  private readonly records = new Map<
    string,
    {
      record: IGlobalPreviewRecord;
      consumed: boolean;
    }
  >();

  constructor(
    private readonly clock: Pick<IGlobalRuntime, 'now' | 'monotonicNow'>,
  ) {}

  put(preview: IGlobalPreview, facts: IGlobalPreviewFacts): IGlobalPreview {
    if (this.records.has(preview.previewId)) return refuse('PREVIEW_CONSUMED');
    const now = this.clock.now();
    const record: IGlobalPreviewRecord = structuredClone({
      preview: {
        ...preview,
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + GLOBAL_PREVIEW_TTL_MS,
        ).toISOString(),
      },
      facts: snapshotGlobalPreviewFacts(facts),
      readyAt: this.clock.monotonicNow(),
    });
    if (Buffer.byteLength(JSON.stringify(record)) > GLOBAL_PREVIEW_BYTES)
      return refuse('LIMIT_EXCEEDED');
    this.records.set(preview.previewId, { record, consumed: false });
    while (this.records.size > GLOBAL_PREVIEW_LIMIT) {
      const oldest = this.records.keys().next().value as string;
      this.records.delete(oldest);
    }
    return structuredClone(record.preview);
  }

  get(previewId: string): IGlobalPreviewRecord {
    const stored = this.records.get(previewId);
    if (!stored) throw new NotFoundException('Global preview', previewId);
    if (stored.consumed) return refuse('PREVIEW_CONSUMED');
    if (
      this.clock.monotonicNow() - stored.record.readyAt >=
      GLOBAL_PREVIEW_TTL_MS
    )
      return refuse('PREVIEW_EXPIRED');
    return structuredClone(stored.record);
  }

  consume(previewId: string): IGlobalPreviewRecord {
    const record = this.get(previewId);
    this.records.get(previewId)!.consumed = true;
    return record;
  }

  clear(): void {
    this.records.clear();
  }
}
