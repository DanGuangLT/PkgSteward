import type { BigIntStats, Dirent } from 'node:fs';
import type { PathPlatform } from '@/common/utils/path.util';
import type { ProtectedTreeMatcher } from '@/core/path-guard/interfaces/path-guard.types';

export type DiskStatus =
  'running' | 'completed' | 'cancelled' | 'timed_out' | 'failed';
export type DiskView = 'directory' | 'packages';
export type DiskStop =
  'cancelled' | 'row_limit' | 'identity_limit' | 'numeric_limit' | null;

export interface IStartDiskUsage {
  path: string;
  view?: DiskView;
  force?: boolean;
}

export interface IDiskUsageRow {
  path: string;
  name: string;
  kind: 'file' | 'directory' | 'link' | 'package';
  canonicalPath: string | null;
  aliases: string[];
  state: 'pending' | 'measuring' | 'complete' | 'partial' | 'excluded';
  sizeBytes: number | null;
  fileCount: number | null;
  reason:
    | 'protected'
    | 'link_skipped'
    | 'outside_root'
    | 'unreadable'
    | 'unsupported'
    | 'identity_unavailable'
    | null;
}

export interface IDiskUsageStart {
  jobId: string;
  status: DiskStatus;
}

export interface IDiskUsageProgress {
  visitedDirs: number;
  visitedEntries: number;
  skippedCount: number;
  skippedLinks: number;
}

export interface IDiskUsageJob extends IDiskUsageStart {
  path: string;
  view: DiskView;
  metric: 'unique-apparent';
  phase: 'listing' | 'measuring';
  partial: boolean;
  stopReason: DiskStop;
  sizeBytes: number | null;
  fileCount: number | null;
  children: IDiskUsageRow[];
  progress: IDiskUsageProgress;
  startedAt: string;
  finishedAt?: string;
  measuredAt: string | null;
  cacheHit: boolean;
  failureCode: 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR' | null;
}

export interface IDiskFs {
  entries(path: string, signal: AbortSignal): AsyncIterable<Dirent>;
  lstat(path: string, signal?: AbortSignal): Promise<BigIntStats>;
  realpath(path: string, signal?: AbortSignal): Promise<string>;
}

export interface IDiskWalkDeps {
  fs: IDiskFs;
  platform: PathPlatform;
  isProtected: ProtectedTreeMatcher;
  onSnapshot(snapshot: IDiskUsageJob): void;
  // Báo phần listing bị cắt mà không thêm hàng thứ 2001 vào snapshot.
  onRowLimit?(): void;
}

export type DiskWalker = (
  initial: IDiskUsageJob,
  signal: AbortSignal,
  deps: IDiskWalkDeps,
) => Promise<IDiskUsageJob>;
