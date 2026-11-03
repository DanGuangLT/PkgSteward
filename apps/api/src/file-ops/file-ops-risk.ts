import { pathApi, type PathPlatform } from '@/common/utils/path.util';
import type { IRisk, RiskCode } from '@/core/risk/interfaces/risk.types';
import {
  assessRisk,
  combineRisks,
  isLargeBatch,
  isRecentlyActive,
  riskIncreased,
} from '@/core/risk/risk';
import type { ICleanupCandidate } from '@/file-ops/cleanup-discovery';
import type {
  FileOpsKind,
  GitStatusResult,
  IClassifiedTarget,
} from '@/file-ops/interfaces/file-ops.types';
import type { ProcessSnapshotResult } from '@/platform/interfaces/process-snapshot.interface';
import { matchProcessesToRoots } from '@/platform/process-match';
import { inspectScanDirectory } from '@/scanner/project-metadata';
import type { IScanFs } from '@/scanner/interfaces/scanner.types';

export type ProcessState = 'none' | 'running' | 'unknown';

export interface IOwnerActivity {
  hasLockfile: boolean | null;
  lastActivityAt: string | null;
  incomplete: boolean;
}

export interface ITargetRiskFacts {
  kind: FileOpsKind;
  activity: IOwnerActivity;
  git: GitStatusResult | null;
  trackedCheck: ICleanupCandidate['trackedCheck'];
  frameworkVerified: boolean | null;
  process: ProcessState;
}

const INCOMPLETE_ACTIVITY: IOwnerActivity = {
  hasLockfile: null,
  lastActivityAt: null,
  incomplete: true,
};

// Plan M4 "Bảng risk": FileOps chỉ ánh xạ dữ kiện → code; level/message nằm ở RISK_CATALOG.
export function targetRiskCodes(
  facts: ITargetRiskFacts,
  now: Date,
): RiskCode[] {
  const { kind, activity, git, process } = facts;
  const orphan = kind === 'orphan_node_modules';
  const codes: RiskCode[] = [];
  if (orphan) codes.push('ORPHAN_NODE_MODULES');
  if (kind === 'node_modules' && activity.hasLockfile === false)
    codes.push('NO_LOCKFILE');
  if (!orphan && git?.state === 'dirty') codes.push('UNCOMMITTED_GIT_CHANGES');
  if (
    activity.lastActivityAt !== null &&
    isRecentlyActive(activity.lastActivityAt, now)
  )
    codes.push('RECENTLY_ACTIVE');
  if (kind === 'build_cache' && facts.frameworkVerified !== true)
    codes.push('UNVERIFIED_CLEANUP_TARGET');
  if (
    activity.incomplete ||
    (!orphan && git?.state === 'unknown') ||
    process === 'unknown' ||
    facts.trackedCheck === 'unknown'
  )
    codes.push('RISK_CHECK_INCOMPLETE');
  if (process === 'running') codes.push('DEV_PROCESS_RUNNING');
  if (kind === 'project') codes.push('DELETE_WHOLE_PROJECT');
  if (kind === 'project_content') codes.push('DELETE_PROJECT_CONTENT');
  return codes;
}

export function assessTargetRisk(facts: ITargetRiskFacts, now: Date): IRisk {
  return assessRisk(targetRiskCodes(facts, now));
}

export function assessSelectionRisk(
  targets: readonly { risk: IRisk; sizeBytes: number }[],
): IRisk {
  const totalBytes = targets.reduce((sum, { sizeBytes }) => sum + sizeBytes, 0);
  return combineRisks(
    targets.map(({ risk }) => risk),
    isLargeBatch(targets.length, totalBytes) ? ['LARGE_BATCH'] : [],
  );
}

export function selectionConfirmText(
  targets: readonly Pick<IClassifiedTarget, 'kind' | 'path'>[],
  risk: IRisk,
  platform: PathPlatform,
): string | null {
  if (risk.level !== 'high') return null;
  if (targets.length === 1 && targets[0].kind === 'project')
    return pathApi(platform).basename(targets[0].path);
  return `DELETE ${targets.length}`;
}

/** Path mà risk lúc execute cao hơn hoặc có code mới so với preview (→ 409 RISK_CHANGED). */
export function changedRiskPaths(
  before: ReadonlyMap<string, IRisk>,
  after: ReadonlyMap<string, IRisk>,
): string[] {
  return [...after]
    .filter(([path, risk]) => {
      const previous = before.get(path);
      return previous === undefined || riskIncreased(previous, risk);
    })
    .map(([path]) => path);
}

export async function readOwnerActivity(
  projectPath: string,
  deps: { platform: PathPlatform; fs: IScanFs; signal: AbortSignal },
): Promise<IOwnerActivity> {
  const { platform, fs, signal } = deps;
  try {
    const entries = await fs.readdir(projectPath);
    const { project } = await inspectScanDirectory(projectPath, entries, {
      platform,
      fs,
      signal,
    });
    if (!project) return { ...INCOMPLETE_ACTIVITY };
    return {
      hasLockfile: project.hasLockfile,
      lastActivityAt: project.lastActivityAt,
      incomplete: false,
    };
  } catch {
    signal.throwIfAborted();
    return { ...INCOMPLETE_ACTIVITY };
  }
}

export async function readOrphanActivity(
  orphanPath: string,
  deps: { fs: Pick<IScanFs, 'lstat'> },
): Promise<IOwnerActivity> {
  try {
    const stats = await deps.fs.lstat(orphanPath);
    return {
      hasLockfile: null,
      lastActivityAt: new Date(stats.mtimeMs).toISOString(),
      incomplete: false,
    };
  } catch {
    return { ...INCOMPLETE_ACTIVITY };
  }
}

export function processStates(
  snapshot: ProcessSnapshotResult,
  roots: readonly string[],
  platform: NodeJS.Platform,
  selfPid: number,
): Map<string, ProcessState> {
  if (snapshot.status !== 'ok')
    return new Map(roots.map((root) => [root, 'unknown']));
  const matches = matchProcessesToRoots(
    snapshot.processes,
    roots,
    platform,
    selfPid,
  );
  return new Map(
    roots.map((root) => [
      root,
      (matches.get(root)?.length ?? 0) > 0 ? 'running' : 'none',
    ]),
  );
}
