import {
  pathApi,
  toComparable,
  type PathPlatform,
} from '@/common/utils/path.util';
import type { PathCheckResult } from '@/core/path-guard/interfaces/path-guard.types';
import type { IRisk } from '@/core/risk/interfaces/risk.types';
import {
  verifyFrameworks,
  type ICleanupCandidate,
} from '@/file-ops/cleanup-discovery';
import {
  assessTargetRisk,
  processStates,
  readOrphanActivity,
  readOwnerActivity,
  type IOwnerActivity,
  type ProcessState,
} from '@/file-ops/file-ops-risk';
import {
  classifyTargets,
  matchBuildCacheName,
  methodForKind,
} from '@/file-ops/file-ops-targets';
import type {
  GitStatusResult,
  IClassifiedTarget,
  IFileOpsFsBundle,
  IGitProbe,
} from '@/file-ops/interfaces/file-ops.types';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import type { IStoredScanResult } from '@/scanner/interfaces/scanner.types';

export interface IAssessedTarget extends IClassifiedTarget {
  hasLockfile: boolean | null;
  lastActivityAt: string | null;
  risk: IRisk;
  defaultSelected: boolean;
}

export interface IAssessDeps {
  platform: PathPlatform;
  fs: IFileOpsFsBundle;
  checkMany(paths: readonly string[]): Promise<PathCheckResult[]>;
  git: IGitProbe;
  processes: IProcessSnapshot;
  selfPid: number;
  now: Date;
  signal: AbortSignal;
}

export async function assessTargets(
  inputPaths: readonly string[],
  scan: Pick<IStoredScanResult, 'projects' | 'orphanNodeModules'>,
  deps: IAssessDeps,
  cleanupFacts?: ReadonlyMap<
    string,
    Pick<ICleanupCandidate, 'trackedCheck' | 'frameworkVerified'>
  >,
): Promise<IAssessedTarget[]> {
  const { platform, fs, git, signal } = deps;
  const api = pathApi(platform);
  const key = (path: string) => toComparable(path, platform);
  signal.throwIfAborted();
  const checks = await deps.checkMany(inputPaths);
  signal.throwIfAborted();
  const targets = await classifyTargets(inputPaths, checks, scan, {
    platform,
    fs: fs.files,
  });
  signal.throwIfAborted();
  const valid = targets.filter((target) => target.valid);
  type CacheFacts = Pick<
    ICleanupCandidate,
    'trackedCheck' | 'frameworkVerified'
  >;
  const cacheFacts = new Map<string, CacheFacts>();
  const caches = valid.filter((target) => target.kind === 'build_cache');

  if (cleanupFacts !== undefined) {
    const comparableFacts = new Map(
      [...cleanupFacts].map(([path, facts]) => [key(path), facts]),
    );
    for (const target of caches) {
      // A missing discovery fact must not turn an unchecked cache into low risk.
      cacheFacts.set(
        key(target.path),
        comparableFacts.get(key(target.path)) ?? {
          trackedCheck: 'unknown',
          frameworkVerified: false,
        },
      );
    }
  } else {
    const byOwner = new Map<string, IClassifiedTarget[]>();
    for (const target of caches) {
      const ownerKey = key(target.owner!.path);
      const group = byOwner.get(ownerKey) ?? [];
      group.push(target);
      byOwner.set(ownerKey, group);
    }
    for (const group of byOwner.values()) {
      signal.throwIfAborted();
      const ownerPath = group[0].owner!.path;
      const tracked = await git.trackedNames(
        ownerPath,
        group.map((target) => api.basename(target.path)),
        signal,
      );
      signal.throwIfAborted();
      const trackedKeys = new Set(
        tracked.state === 'ok'
          ? tracked.tracked.map((name) => key(api.join(ownerPath, name)))
          : [],
      );
      for (const target of group) {
        if (trackedKeys.has(key(target.path))) {
          target.kind = 'project_content';
          target.method = methodForKind('project_content');
        }
      }
      const remaining = group.filter((target) => target.kind === 'build_cache');
      if (remaining.length === 0) continue;
      const names = remaining
        .map((target) =>
          matchBuildCacheName(api.basename(target.path), platform),
        )
        .filter((name) => name !== null);
      const frameworks = await verifyFrameworks(ownerPath, names, {
        platform,
        fs: fs.files,
        signal,
      });
      signal.throwIfAborted();
      for (const target of remaining) {
        const name = matchBuildCacheName(api.basename(target.path), platform);
        cacheFacts.set(key(target.path), {
          trackedCheck: tracked.state === 'ok' ? 'clean' : tracked.state,
          frameworkVerified: name !== null && frameworks.get(name) === true,
        });
      }
    }
  }

  const ownerActivities = new Map<string, IOwnerActivity>();
  const activities = new Map<string, IOwnerActivity>();
  const owners = new Map<string, string>();
  const roots = new Map<string, string>();
  for (const target of valid) {
    signal.throwIfAborted();
    let activity: IOwnerActivity;
    let root: string;
    if (target.kind === 'orphan_node_modules') {
      root = api.dirname(target.path);
      activity = await readOrphanActivity(target.path, { fs: fs.scan });
      signal.throwIfAborted();
    } else {
      root = target.owner!.path;
      const ownerKey = key(root);
      owners.set(ownerKey, root);
      const cached = ownerActivities.get(ownerKey);
      if (cached !== undefined) {
        activity = cached;
      } else {
        activity = await readOwnerActivity(root, {
          platform,
          fs: fs.scan,
          signal,
        });
        signal.throwIfAborted();
        ownerActivities.set(ownerKey, activity);
      }
    }
    activities.set(key(target.path), activity);
    if (!roots.has(key(root))) roots.set(key(root), root);
  }

  const statuses = new Map<string, GitStatusResult>();
  for (const [ownerKey, ownerPath] of owners) {
    signal.throwIfAborted();
    const status = await git.status(ownerPath, signal);
    signal.throwIfAborted();
    statuses.set(ownerKey, status);
  }
  signal.throwIfAborted();
  // Invalid-only batches must not trigger a machine-wide process capture.
  let matched = new Map<string, ProcessState>();
  if (valid.length > 0) {
    const snapshot = await deps.processes.capture();
    signal.throwIfAborted();
    matched = processStates(
      snapshot,
      [...roots.values()],
      platform === 'win32' ? 'win32' : 'linux',
      deps.selfPid,
    );
  }
  return targets.map((target): IAssessedTarget => {
    signal.throwIfAborted();
    if (!target.valid) {
      return {
        ...target,
        hasLockfile: null,
        lastActivityAt: null,
        risk: { level: 'low', reasons: [] },
        defaultSelected: false,
      };
    }
    const activity = activities.get(key(target.path))!;
    const orphan = target.kind === 'orphan_node_modules';
    const root = orphan ? api.dirname(target.path) : target.owner!.path;
    const cache =
      target.kind === 'build_cache'
        ? cacheFacts.get(key(target.path))
        : undefined;
    const risk = assessTargetRisk(
      {
        kind: target.kind!,
        activity,
        git: orphan ? null : statuses.get(key(root))!,
        trackedCheck: cache?.trackedCheck ?? null,
        frameworkVerified: cache?.frameworkVerified ?? null,
        process: matched.get(roots.get(key(root))!) ?? 'unknown',
      },
      deps.now,
    );
    return {
      ...target,
      hasLockfile: activity.hasLockfile,
      lastActivityAt: activity.lastActivityAt,
      risk,
      defaultSelected:
        target.kind === 'node_modules' &&
        activity.hasLockfile === true &&
        risk.level !== 'high',
    };
  });
}
