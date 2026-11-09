import { createHash } from 'node:crypto';
import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import {
  isProjectRecord,
  yieldProjectBatch,
} from '@/projects/project-lock-common';
import type {
  IProjectRegistry,
  IRegistryPackageMetadata,
} from '@/projects/interfaces/projects.runtime';
import {
  getPmTargetReason,
  resolvePmTarget,
} from '@/package-managers/pm-policy';
import { PM_MANAGERS } from '@/package-managers/interfaces/pm.types';
import type {
  PmManager,
  PmReasonCode,
} from '@/package-managers/interfaces/pm.types';
import type {
  IPmCatalog,
  IPmRegistry,
  IPmTargetProof,
} from '@/package-managers/interfaces/pm.runtime';

const LIMIT = 10_000;
const TAG = /^[a-z][a-z0-9-]{0,63}$/;
const canonical = (value: unknown): value is string =>
  typeof value === 'string' &&
  !value.includes('+') &&
  semver.valid(value) === value;
const failure = (reason: PmReasonCode) =>
  new AppException(
    503,
    'Public package manager catalog unavailable',
    'SERVICE_UNAVAILABLE',
    { reason },
  );
const errorReason = (error: unknown): PmReasonCode => {
  const code: unknown = isProjectRecord(error) ? error.code : undefined;
  switch (code) {
    case 'REGISTRY_AUTH_REQUIRED':
      return 'REGISTRY_AUTH_REQUIRED';
    case 'PACKAGE_NOT_FOUND':
      return 'REGISTRY_NOT_FOUND';
    case 'REGISTRY_RATE_LIMITED':
      return 'REGISTRY_RATE_LIMITED';
    case 'INVALID_REGISTRY_RESPONSE':
      return 'REGISTRY_INVALID_RESPONSE';
    case 'LIMIT_EXCEEDED':
      return 'LIMIT_EXCEEDED';
    default:
      return 'REGISTRY_UNAVAILABLE';
  }
};

/** No config, credentials or project data enter this fixed public-name adapter. */
export class PmRegistry implements IPmRegistry {
  constructor(
    private readonly source: Pick<IProjectRegistry, 'getPackageMetadata'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readCatalog(
    manager: PmManager,
    installedVersion: string | null,
    signal: AbortSignal,
  ): Promise<IPmCatalog> {
    signal.throwIfAborted();
    if (!PM_MANAGERS.includes(manager)) throw failure('UNSUPPORTED_MANAGER');
    let value: IRegistryPackageMetadata;
    try {
      value = await this.source.getPackageMetadata(manager, signal);
    } catch (error) {
      signal.throwIfAborted();
      throw failure(errorReason(error));
    }
    signal.throwIfAborted();
    if (
      !isProjectRecord(value) ||
      !Array.isArray(value.versions) ||
      !isProjectRecord(value.distTags) ||
      (value.deprecatedVersions !== undefined &&
        !Array.isArray(value.deprecatedVersions))
    )
      throw failure('REGISTRY_INVALID_RESPONSE');
    const versions = value.versions;
    const tags = Object.entries(value.distTags);
    const deprecated = value.deprecatedVersions ?? [];
    if (
      versions.length > LIMIT ||
      tags.length > LIMIT ||
      deprecated.length > LIMIT
    )
      throw failure('LIMIT_EXCEEDED');
    const known = new Set<string>();
    let count = 0;
    const checkpoint = async () => {
      signal.throwIfAborted();
      if (++count % 256 === 0) await yieldProjectBatch(signal);
    };
    for (const version of versions) {
      if (!canonical(version) || known.has(version))
        throw failure('REGISTRY_INVALID_RESPONSE');
      known.add(version);
      await checkpoint();
    }
    for (const [tag, version] of tags) {
      if (
        !TAG.test(tag) ||
        /[\r\n]/.test(tag) ||
        !canonical(version) ||
        !known.has(version)
      )
        throw failure('REGISTRY_INVALID_RESPONSE');
      await checkpoint();
    }
    const deprecatedSet = new Set<string>();
    for (const version of deprecated) {
      if (
        !canonical(version) ||
        !known.has(version) ||
        deprecatedSet.has(version)
      )
        throw failure('REGISTRY_INVALID_RESPONSE');
      deprecatedSet.add(version);
      await checkpoint();
    }
    signal.throwIfAborted();
    const ordered = [...known].sort(semver.rcompare);
    const metadata: IRegistryPackageMetadata = {
      versions: ordered,
      distTags: Object.fromEntries(tags),
      deprecatedVersions: [...deprecatedSet],
    };
    return {
      manager,
      asOf: this.now().toISOString(),
      stale: false,
      tags: { ...metadata.distTags },
      metadata,
      versions: ordered.map((version) => {
        const deprecated = deprecatedSet.has(version);
        const reason = getPmTargetReason(
          manager,
          installedVersion,
          version,
          deprecated,
        );
        return { version, deprecated, supported: reason === null, reason };
      }),
    };
  }

  resolveTarget(
    catalog: IPmCatalog,
    requested: string,
    installedVersion: string | null,
  ): IPmTargetProof {
    if (catalog.stale) throw failure('REGISTRY_UNAVAILABLE');
    const targetVersion = resolvePmTarget(
      catalog.manager,
      requested,
      installedVersion,
      catalog.metadata,
    );
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          manager: catalog.manager,
          requested,
          targetVersion,
          tag: canonical(requested) ? null : requested,
          deprecated:
            catalog.metadata.deprecatedVersions?.includes(targetVersion) ??
            false,
          support: getPmTargetReason(
            catalog.manager,
            installedVersion,
            targetVersion,
            false,
          ),
        }),
      )
      .digest('hex');
    return { requestedVersion: requested, targetVersion, fingerprint };
  }
}
