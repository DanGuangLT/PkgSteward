import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import { assessRisk, isRecentlyActive } from '@/core/risk/risk';
import type { IRisk } from '@/core/risk/interfaces/risk.types';
import type { IRegistryPackageMetadata } from '@/projects/interfaces/projects.runtime';
import type {
  IPmInstalledTool,
  IPmPinState,
  IPmWorkspace,
  PmManager,
  PmReasonCode,
  PmWarningCode,
} from '@/package-managers/interfaces/pm.types';

const DISPLAY_LIMIT = 1024;
const CATALOG_LIMIT = 10_000;
const TAG = /^[a-z][a-z0-9-]{0,63}$/;
const canonicalVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  !value.includes('+') &&
  semver.valid(value) === value;

export function parsePmPin(
  raw: unknown,
  present = raw !== undefined,
): IPmPinState {
  if (!present)
    return {
      rawPin: null,
      rawPinTruncated: false,
      pinState: 'missing',
      parsedPin: null,
      pinReason: null,
    };
  let display: string;
  try {
    display =
      typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw));
  } catch {
    display = '[unsupported value]';
  }
  const base = {
    rawPin: display.slice(0, DISPLAY_LIMIT),
    rawPinTruncated: display.length > DISPLAY_LIMIT,
  };
  const inert: IPmPinState = {
    ...base,
    pinState: 'unsupported',
    parsedPin: null,
    pinReason: 'PIN_UNSUPPORTED',
  };
  if (typeof raw !== 'string' || raw.length > DISPLAY_LIMIT) return inert;
  const match =
    /^(npm|pnpm|yarn)@([^+]+)(?:\+(sha224\.[a-fA-F0-9]{56}|sha256\.[a-fA-F0-9]{64}|sha384\.[a-fA-F0-9]{96}|sha512\.[a-fA-F0-9]{128}))?$/.exec(
      raw,
    );
  if (!match || match[0] !== raw || !canonicalVersion(match[2])) return inert;
  return {
    ...base,
    pinState: 'parsed',
    pinReason: null,
    parsedPin: {
      manager: match[1] as PmManager,
      version: match[2],
      hash: match[3] ?? null,
    },
  };
}

export const isPmTargetVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 128 &&
  (canonicalVersion(value) || (TAG.test(value) && !/[\r\n]/.test(value)));

export function getPmTargetReason(
  manager: PmManager,
  installedVersion: string | null,
  targetVersion: string,
  deprecated: boolean,
): PmReasonCode | null {
  if (manager !== 'npm' && manager !== 'pnpm') return 'UNSUPPORTED_MANAGER';
  if (installedVersion === null) return 'TOOL_NOT_FOUND';
  if (
    !canonicalVersion(installedVersion) ||
    semver.major(installedVersion) !== 11 ||
    semver.prerelease(installedVersion) !== null
  )
    return 'TOOL_VERSION_MISMATCH';
  if (
    !canonicalVersion(targetVersion) ||
    semver.major(targetVersion) !== 11 ||
    semver.prerelease(targetVersion) !== null ||
    deprecated
  )
    return 'TARGET_VERSION_UNSUPPORTED';
  return null;
}

const refuseTarget = (reason: PmReasonCode, status = 400): never => {
  throw new AppException(
    status,
    'Package manager target is unavailable',
    status === 503 ? 'SERVICE_UNAVAILABLE' : 'VALIDATION_ERROR',
    { reason },
  );
};

/** Operates on fresh, app-owned public metadata only; performs no IO. */
export function resolvePmTarget(
  manager: PmManager,
  requested: string,
  installedVersion: string | null,
  metadata: IRegistryPackageMetadata,
): string {
  const { versions, distTags, deprecatedVersions = [] } = metadata;
  if (
    !Array.isArray(versions) ||
    !distTags ||
    typeof distTags !== 'object' ||
    Array.isArray(distTags) ||
    !Array.isArray(deprecatedVersions)
  )
    return refuseTarget('REGISTRY_INVALID_RESPONSE', 503);
  const tags = Object.entries(distTags);
  if (
    versions.length > CATALOG_LIMIT ||
    tags.length > CATALOG_LIMIT ||
    deprecatedVersions.length > CATALOG_LIMIT
  )
    return refuseTarget('LIMIT_EXCEEDED', 503);
  const known = new Set(versions);
  if (
    known.size !== versions.length ||
    versions.some((version) => !canonicalVersion(version)) ||
    tags.some(
      ([tag, version]) =>
        !TAG.test(tag) ||
        /[\r\n]/.test(tag) ||
        !canonicalVersion(version) ||
        !known.has(version),
    ) ||
    deprecatedVersions.some((version) => !known.has(version))
  )
    return refuseTarget('REGISTRY_INVALID_RESPONSE', 503);
  if (!isPmTargetVersion(requested))
    return refuseTarget('TARGET_VERSION_UNSUPPORTED');
  const target = canonicalVersion(requested)
    ? requested
    : Object.hasOwn(distTags, requested)
      ? distTags[requested]
      : null;
  if (target === null || !known.has(target))
    return refuseTarget('TARGET_VERSION_UNSUPPORTED');
  const reason = getPmTargetReason(
    manager,
    installedVersion,
    target,
    deprecatedVersions.includes(target),
  );
  if (reason) return refuseTarget(reason);
  return target;
}

export interface IPmPinChangeInput {
  pin: IPmPinState;
  manager: PmManager;
  installed: IPmInstalledTool;
  /** Already resolved/proven by the fresh public catalog adapter. */
  targetVersion: string;
  lockManagers: readonly PmManager[];
  workspace: IPmWorkspace;
  devEnginesPresent: boolean;
  inputReason: PmReasonCode | null;
}
export interface IPmPinDecision {
  eligible: boolean;
  reason: PmReasonCode | null;
  targetPin: string | null;
  warnings: PmWarningCode[];
}

export function assessPmPinChange(input: IPmPinChangeInput): IPmPinDecision {
  const {
    pin,
    manager,
    installed,
    targetVersion,
    workspace,
    devEnginesPresent,
  } = input;
  const warnings: PmWarningCode[] = ['PIN_DOES_NOT_SWITCH_RUNNER'];
  if (devEnginesPresent) warnings.push('DEV_ENGINES_NOT_MANAGED');
  const blocked = (reason: PmReasonCode): IPmPinDecision => ({
    eligible: false,
    reason,
    targetPin: null,
    warnings,
  });
  if (devEnginesPresent) return blocked('CONFIG_UNSUPPORTED');
  if (pin.pinState === 'unsupported') return blocked('PIN_UNSUPPORTED');
  if (workspace.kind === 'leaf') return blocked('WORKSPACE_LEAF');
  if (manager === 'yarn') return blocked('UNSUPPORTED_MANAGER');
  if (installed.manager !== manager) return blocked('UNSUPPORTED_MANAGER');
  if (installed.status !== 'available' || installed.reason !== null)
    return blocked(installed.reason ?? 'TOOL_NOT_FOUND');
  const targetReason = getPmTargetReason(
    manager,
    installed.version,
    targetVersion,
    false,
  );
  if (targetReason) return blocked(targetReason);
  const old = pin.parsedPin;
  // Only a proven old-pin major mismatch is repairable; never clear another input blocker.
  const repairable =
    input.inputReason === 'TOOL_VERSION_MISMATCH' &&
    old !== null &&
    old.manager === manager &&
    canonicalVersion(old.version) &&
    semver.major(old.version) !== 11;
  if (input.inputReason && !repairable) return blocked(input.inputReason);
  const families = new Set(input.lockManagers);
  if (families.size > 1 || [...families].some((family) => family !== manager))
    return blocked('LOCKFILE_MISMATCH');
  if (old?.manager === manager && old.version === targetVersion)
    return blocked('NO_VERSION_CHANGE');
  if (old?.hash) warnings.push('PIN_HASH_REMOVED');
  return {
    eligible: true,
    reason: null,
    targetPin: `${manager}@${targetVersion}`,
    warnings,
  };
}

export function getPmRisk(lastActivityAt: string | null, now: Date): IRisk {
  return assessRisk(
    lastActivityAt !== null && isRecentlyActive(lastActivityAt, now)
      ? ['RECENTLY_ACTIVE']
      : [],
  );
}
