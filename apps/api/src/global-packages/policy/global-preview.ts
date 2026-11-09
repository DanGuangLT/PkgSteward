import type {
  IGlobalPreviewFacts,
  IGlobalLocation,
  IGlobalRuntime,
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
} from '@/global-packages/policy/global-policy';
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

function snapshotLocation(location: IGlobalLocation): IGlobalLocation {
  return {
    ...location,
    tool: {
      ...location.tool,
      identities: location.tool.identities.map(snapshotIdentity),
    },
    configIdentities: location.configIdentities.map((identity) => ({
      ...identity,
      file: snapshotIdentity(identity.file),
    })),
    ...(location.pnpm ? { pnpm: snapshotPnpmConfig(location.pnpm) } : {}),
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

export function snapshotGlobalPreviewFacts(
  facts: IGlobalPreviewFacts,
): IGlobalPreviewFacts {
  return structuredClone({
    ...facts,
    location: snapshotLocation(facts.location),
    locations: facts.locations?.map(snapshotLocation),
    current: {
      ...facts.current,
      manifest: {
        ...facts.current.manifest,
        file: snapshotIdentity(facts.current.manifest.file),
      },
      binIdentities: facts.current.binIdentities.map(snapshotIdentity),
      ...(facts.current.pnpmGroup
        ? { pnpmGroup: snapshotGroup(facts.current.pnpmGroup) }
        : {}),
    },
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
  };
}

function comparable(facts: IGlobalPreviewFacts) {
  const { location, current, target } = facts;
  return {
    location: locationFacts(location),
    locations: facts.locations
      ?.map(locationFacts)
      .sort((a, b) => a.manager.localeCompare(b.manager)),
    current: {
      ...current,
      packageRoot: pathKey(current.packageRoot),
      manifest: {
        sha256: current.manifest.sha256,
        file: identityFacts(current.manifest.file),
      },
      bins: sortBins(current.bins),
      binIdentities: identities(current.binIdentities),
      pnpmGroup: current.pnpmGroup ? groupFacts(current.pnpmGroup) : undefined,
    },
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
  if (
    request.package !== current.name ||
    request.manager !== location.manager ||
    (request.action === 'change'
      ? !target ||
        target.name !== current.name ||
        target.requestedVersion !== request.targetVersion
      : target !== null)
  )
    return refuse('PREVIEW_CHANGED');
  const before = sortBins(current.bins);
  const after = sortBins(target?.bins ?? []);
  const warnings = target
    ? assessGlobalVersionChange(current.version, target.version)
    : [];
  const preview: IGlobalPreview = {
    previewId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GLOBAL_PREVIEW_TTL_MS).toISOString(),
    manager: request.manager,
    managerVersion: location.tool.version,
    action: request.action,
    package: current.name,
    currentVersion: current.version,
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
    warningCodes: [
      ...warnings,
      'GLOBAL_CODE_EXECUTION',
      'GLOBAL_CONSUMERS_UNKNOWN',
      'PROCESS_ESCAPE_RESIDUAL',
    ],
    risk: getGlobalRisk(),
    confirmText: globalConfirmText(
      request.manager,
      request.action,
      current.name,
      target?.version ?? null,
    ),
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
