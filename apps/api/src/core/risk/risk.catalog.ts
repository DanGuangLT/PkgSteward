import type { RiskCode, RiskLevel } from '@/core/risk/interfaces/risk.types';

export const RISK_CATALOG: Readonly<
  Record<RiskCode, { level: RiskLevel; message: string }>
> = Object.freeze({
  DEV_PROCESS_RUNNING: Object.freeze({
    level: 'high',
    message: 'A running process appears to use this location',
  }),
  DELETE_WHOLE_PROJECT: Object.freeze({
    level: 'high',
    message: 'Deletes the whole project folder',
  }),
  DELETE_PROJECT_CONTENT: Object.freeze({
    level: 'high',
    message: 'Deletes project source files or folders',
  }),
  MACHINE_WIDE: Object.freeze({
    level: 'high',
    message: 'Changes a machine-wide version',
  }),
  UNCOMMITTED_GIT_CHANGES: Object.freeze({
    level: 'medium',
    message: 'Project has uncommitted Git changes',
  }),
  NO_LOCKFILE: Object.freeze({
    level: 'medium',
    message:
      'Project has no lockfile, so reinstalling may not restore the same versions',
  }),
  RECENTLY_ACTIVE: Object.freeze({
    level: 'medium',
    message: 'Project was active within the last 7 days',
  }),
  LARGE_BATCH: Object.freeze({
    level: 'medium',
    message: 'Large batch: 20 or more items, or 5 GB or more',
  }),
  UNVERIFIED_CLEANUP_TARGET: Object.freeze({
    level: 'medium',
    message:
      'Folder name matches a build cache, but the project does not use the matching tool',
  }),
  RISK_CHECK_INCOMPLETE: Object.freeze({
    level: 'medium',
    message: 'Some risk checks could not be completed',
  }),
  ORPHAN_NODE_MODULES: Object.freeze({
    level: 'low',
    message: 'node_modules folder whose parent has no package.json',
  }),
});

export const RISK_THRESHOLDS = {
  recentlyActiveMs: 7 * 24 * 60 * 60 * 1000,
  largeBatchCount: 20,
  largeBatchBytes: 5_000_000_000,
} as const;
