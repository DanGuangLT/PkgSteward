import type { BigIntStats, Dirent } from 'node:fs';
import { lstat, opendir, realpath } from 'node:fs/promises';
import {
  isSameOrInside,
  pathApi,
  toComparable,
} from '@/common/utils/path.util';
import {
  DISK_IDENTITY_LIMIT,
  fileIdentity,
} from '@/disk-usage/disk-usage-identity';
import {
  DISK_ROW_LIMIT,
  listPackageTargets,
} from '@/disk-usage/disk-usage-packages';
import type {
  DiskWalker,
  DiskStop,
  IDiskFs,
  IDiskUsageJob,
  IDiskUsageRow,
} from '@/disk-usage/interfaces/disk-usage.types';

export const DISK_CONCURRENCY = 8;
export const DISK_WALKER = Symbol('DISK_WALKER');
export const DISK_FS = Symbol('DISK_FS');

let metadataActive = 0;
const metadataWaiters: (() => void)[] = [];

const withMetadataPermit = async <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const index = metadataWaiters.indexOf(start);
      if (index >= 0) metadataWaiters.splice(index, 1);
      reject(new Error('Disk metadata operation cancelled'));
    };
    const start = () => {
      signal?.removeEventListener('abort', onAbort);
      metadataActive++;
      resolve();
    };
    if (signal?.aborted) {
      reject(new Error('Disk metadata operation cancelled'));
    } else if (metadataActive < DISK_CONCURRENCY) {
      start();
    } else {
      metadataWaiters.push(start);
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    if (signal?.aborted) throw new Error('Disk metadata operation cancelled');
    return await operation();
  } finally {
    // Huỷ job không trả permit sớm: syscall phải thật sự settle trước.
    metadataActive--;
    metadataWaiters.shift()?.();
  }
};

export const createDiskFs = (): IDiskFs => ({
  lstat: (path, signal) =>
    withMetadataPermit(() => lstat(path, { bigint: true }), signal),
  realpath: (path, signal) => withMetadataPermit(() => realpath(path), signal),
  async *entries(path, signal) {
    if (signal.aborted) return;
    let directory: Awaited<ReturnType<typeof opendir>> | undefined;
    try {
      directory = await withMetadataPermit(() => opendir(path), signal);
      if (signal.aborted) return;
      const handle = directory;
      while (!signal.aborted) {
        const entry = await withMetadataPermit(() => handle.read(), signal);
        if (signal.aborted || !entry) return;
        yield entry;
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      if (directory) {
        const handle = directory;
        await withMetadataPermit(() => handle.close());
      }
    }
  },
});

interface IBucket {
  row: IDiskUsageRow | null;
  bytes: bigint;
  count: number;
  identities: Set<string>;
  visited: boolean;
  partial: boolean;
}

interface IQueuedDirectory {
  path: string;
  buckets: IBucket[];
  entries?: Dirent[];
  root: boolean;
}

const makeBucket = (row: IDiskUsageRow | null): IBucket => ({
  row,
  bytes: 0n,
  count: 0,
  identities: new Set(),
  visited: false,
  partial: false,
});

const errorCode = (error: unknown): string | null =>
  error !== null &&
  typeof error === 'object' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null;

const terminalSnapshot = (job: IDiskUsageJob): IDiskUsageJob => {
  const snapshot = structuredClone(job);
  for (const row of snapshot.children) {
    Object.freeze(row.aliases);
    Object.freeze(row);
  }
  Object.freeze(snapshot.children);
  Object.freeze(snapshot.progress);
  return Object.freeze(snapshot);
};

// initial.path là realPath đã được PathGuard.assertAllowed cấp quyền.
export const walkDiskUsage: DiskWalker = (initial, signal, deps) =>
  new Promise<IDiskUsageJob>((resolve) => {
    const { fs, platform, isProtected } = deps;
    const api = pathApi(platform);
    const root = api.resolve(initial.path);
    const rootKey = toComparable(root, platform);
    const job = structuredClone(initial);
    const work = new AbortController();
    const total = makeBucket(null);
    const rows: IDiskUsageRow[] = [];
    const buckets: IBucket[] = [];
    const directRows = new Map<string, IBucket>();
    const packageTargets = new Map<string, IBucket[]>();
    const visitedDirectories = new Set<string>();
    const queue: (IQueuedDirectory | undefined)[] = [];
    let next = 0;
    let active = 0;
    let stopped = false;
    let incomplete = false;
    let identities = 0;
    let lastPublished = 0;
    let rootEntries: Dirent[] | undefined;

    const outputRows = (listing = false): IDiskUsageRow[] => {
      if (listing) return rows.slice(0, DISK_ROW_LIMIT);
      return [...rows]
        .sort((left, right) => {
          if (left.sizeBytes === null || right.sizeBytes === null) {
            if (left.sizeBytes !== null) return -1;
            if (right.sizeBytes !== null) return 1;
            // Sort ổn định giữ thứ tự listing cho các hàng còn pending.
            if (job.status === 'running') return 0;
          } else if (left.sizeBytes !== right.sizeBytes) {
            return right.sizeBytes - left.sizeBytes;
          }
          if (left.name !== right.name) return left.name < right.name ? -1 : 1;
          return left.path === right.path ? 0 : left.path < right.path ? -1 : 1;
        })
        .slice(0, DISK_ROW_LIMIT);
    };

    const updateNumbers = () => {
      job.sizeBytes = Number(total.bytes);
      job.fileCount = total.count;
      for (const bucket of buckets) {
        const row = bucket.row;
        if (bucket.visited && row && row.state !== 'excluded') {
          row.sizeBytes = Number(bucket.bytes);
          row.fileCount = bucket.count;
        }
      }
    };
    const publish = (listing = false) => {
      if (stopped) return;
      const now = Date.now();
      if (!listing && now - lastPublished < 250) return;
      if (!listing) updateNumbers();
      deps.onSnapshot(
        structuredClone({ ...job, children: outputRows(listing) }),
      );
      lastPublished = Date.now();
    };
    const finish = (
      status: IDiskUsageJob['status'],
      reason: DiskStop = null,
      failureCode: IDiskUsageJob['failureCode'] = null,
    ) => {
      if (stopped) return;
      stopped = true;
      signal.removeEventListener('abort', onAbort);
      const traversalComplete =
        status === 'completed' && (reason === null || reason === 'row_limit');
      const stopReason =
        reason ??
        (status === 'completed' && rows.length > DISK_ROW_LIMIT
          ? 'row_limit'
          : null);
      updateNumbers();
      for (const bucket of buckets) {
        const row = bucket.row;
        if (!row || row.state === 'excluded') continue;
        if (!bucket.visited) {
          row.state = traversalComplete ? 'excluded' : 'partial';
          if (row.state === 'excluded') {
            row.canonicalPath = null;
            row.reason = 'unreadable';
            job.progress.skippedCount++;
            incomplete = true;
          }
        } else {
          row.state =
            bucket.partial || !traversalComplete ? 'partial' : 'complete';
        }
      }
      if (!traversalComplete) {
        for (const row of rows) {
          if (row.state === 'pending' || row.state === 'measuring') {
            row.state = 'partial';
          }
        }
      }
      job.status = status;
      job.stopReason = stopReason;
      job.failureCode = failureCode;
      job.partial = incomplete || status !== 'completed' || stopReason !== null;
      job.finishedAt = new Date().toISOString();
      job.measuredAt = status === 'completed' ? job.finishedAt : null;
      const result = terminalSnapshot({ ...job, children: outputRows() });
      work.abort();
      queue.length = 0;
      if (rootEntries) rootEntries.length = 0;
      rootEntries = undefined;
      directRows.clear();
      packageTargets.clear();
      visitedDirectories.clear();
      total.identities.clear();
      for (const bucket of buckets) bucket.identities.clear();
      buckets.length = 0;
      rows.length = 0;
      job.children = [];
      try {
        deps.onSnapshot(terminalSnapshot(result));
      } finally {
        resolve(result);
      }
    };
    const onAbort = () => finish('cancelled', 'cancelled');
    const fail = (error: unknown) => {
      if (stopped) return;
      const code = errorCode(error);
      const failureCode =
        code === 'ENOENT'
          ? 'NOT_FOUND'
          : code === 'EPERM' || code === 'EACCES'
            ? 'FORBIDDEN'
            : 'INTERNAL_SERVER_ERROR';
      if (failureCode === 'INTERNAL_SERVER_ERROR') deps.onError?.(error);
      finish('failed', null, failureCode);
    };
    const markIssue = (
      affected: IBucket[],
      reason: IDiskUsageRow['reason'],
      direct?: IBucket,
      excluded = false,
    ) => {
      if (stopped) return;
      job.progress.skippedCount++;
      // Metric chỉ tính file thường trong cây vật lý; bỏ metadata link là chủ đích.
      const partial = reason !== 'link_skipped';
      if (partial) {
        incomplete = true;
        for (const bucket of affected) {
          bucket.partial = true;
          if (bucket.row) bucket.row.reason ??= reason;
        }
      }
      if (direct?.row) {
        direct.partial ||= partial;
        if (excluded) {
          direct.row.state = 'excluded';
          direct.row.canonicalPath = null;
          direct.row.sizeBytes = null;
          direct.row.fileCount = null;
        } else {
          direct.visited = true;
          direct.row.state = 'partial';
        }
        direct.row.reason = reason;
      }
    };
    const addFile = (
      stats: BigIntStats,
      affected: IBucket[],
      direct?: IBucket,
    ) => {
      if (stats.nlink < 1n || stats.ino <= 0n || stats.dev < 0n) {
        markIssue(affected, 'identity_unavailable', direct);
        return;
      }
      if (stats.size < 0n) {
        markIssue(affected, 'unsupported', direct);
        return;
      }
      const identity = stats.nlink > 1n ? fileIdentity(stats) : null;
      if (stats.nlink > 1n && identity === null) {
        markIssue(affected, 'identity_unavailable', direct);
        return;
      }
      const destinations = [total, ...affected].filter(
        (bucket) => identity === null || !bucket.identities.has(identity),
      );
      if (
        identity !== null &&
        identities + destinations.length > DISK_IDENTITY_LIMIT
      ) {
        finish('completed', 'identity_limit');
        return;
      }
      // Kiểm tất cả bucket trước khi cộng: không để một file bị cộng dở dang.
      if (
        destinations.some(
          (bucket) =>
            bucket.bytes + stats.size > BigInt(Number.MAX_SAFE_INTEGER) ||
            bucket.count === Number.MAX_SAFE_INTEGER,
        )
      ) {
        finish('completed', 'numeric_limit');
        return;
      }
      for (const bucket of destinations) {
        if (identity !== null) {
          bucket.identities.add(identity);
          identities++;
        }
        bucket.bytes += stats.size;
        bucket.count++;
      }
    };

    const inspectChild = async (
      input: string,
      entry: Dirent,
      parentBuckets: IBucket[],
    ): Promise<void> => {
      if (stopped) return;
      const direct = directRows.get(toComparable(input, platform));
      if (isProtected(input)) {
        markIssue(parentBuckets, 'protected', direct, true);
        return;
      }
      let kind: 'file' | 'directory' | 'link' | 'unsupported' | null =
        entry.isSymbolicLink()
          ? 'link'
          : entry.isDirectory()
            ? 'directory'
            : entry.isFile()
              ? 'file'
              : entry.isBlockDevice() ||
                  entry.isCharacterDevice() ||
                  entry.isFIFO() ||
                  entry.isSocket()
                ? 'unsupported'
                : null;
      let stats: BigIntStats | undefined;
      if (kind === 'file' || kind === null) {
        try {
          stats = await fs.lstat(input, work.signal);
        } catch {
          if (!stopped) markIssue(parentBuckets, 'unreadable', direct);
          return;
        }
        if (stopped) return;
        if (stats.isSymbolicLink()) kind = 'link';
        else if (kind === null) {
          kind = stats.isDirectory()
            ? 'directory'
            : stats.isFile()
              ? 'file'
              : 'unsupported';
        } else if (!stats.isFile()) kind = 'unsupported';
      }
      if (stopped) return;
      if (kind === 'link') {
        if (direct?.row) direct.row.kind = 'link';
        job.progress.skippedLinks++;
        markIssue(parentBuckets, 'link_skipped', direct, true);
        return;
      }
      if (kind !== 'directory' && kind !== 'file') {
        markIssue(parentBuckets, 'unsupported', direct, true);
        return;
      }
      let canonical = input;
      if (kind === 'directory') {
        try {
          canonical = api.resolve(await fs.realpath(input, work.signal));
        } catch {
          if (!stopped) markIssue(parentBuckets, 'unreadable', direct);
          return;
        }
      }
      if (stopped) return;
      const key = toComparable(canonical, platform);
      if (!isSameOrInside(key, rootKey, platform)) {
        markIssue(parentBuckets, 'outside_root', direct, true);
        return;
      }
      if (isProtected(canonical)) {
        markIssue(parentBuckets, 'protected', direct, true);
        return;
      }
      const affected = [...parentBuckets];
      for (const bucket of [
        ...(direct ? [direct] : []),
        ...(packageTargets.get(key) ?? []),
      ]) {
        if (!affected.includes(bucket)) affected.push(bucket);
      }
      if (direct?.row) {
        direct.row.kind = kind;
        direct.row.canonicalPath = canonical;
      }
      if (kind === 'file' && stats) {
        for (const bucket of affected) {
          bucket.visited = true;
          if (bucket.row?.state === 'pending') bucket.row.state = 'measuring';
        }
        addFile(stats, affected, direct);
      } else if (kind === 'directory' && !visitedDirectories.has(key)) {
        visitedDirectories.add(key);
        queue.push({ path: canonical, buckets: affected, root: false });
        schedule();
      } else {
        markIssue(parentBuckets, 'unsupported', direct, true);
      }
      publish();
    };

    const visit = async (item: IQueuedDirectory) => {
      if (stopped) return;
      for (const bucket of item.buckets) {
        bucket.visited = true;
        if (bucket.row) bucket.row.state = 'measuring';
      }
      job.progress.visitedDirs++;
      // Chỉ bắt lỗi iterator filesystem; lỗi matcher phải đi tới fail().
      const iterator = (
        item.entries ? null : fs.entries(item.path, work.signal)
      )?.[Symbol.asyncIterator]();
      let index = 0;
      try {
        while (!stopped) {
          let entry: Dirent | undefined;
          if (item.entries) {
            entry = item.entries[index++];
          } else if (iterator) {
            try {
              const result = await iterator.next();
              if (stopped) return;
              entry = result.done ? undefined : result.value;
            } catch (error) {
              if (stopped) return;
              if (item.root) throw error;
              markIssue(item.buckets, 'unreadable');
              return;
            }
          }
          if (!entry || stopped) break;
          job.progress.visitedEntries++;
          await inspectChild(
            api.join(item.path, entry.name),
            entry,
            item.buckets,
          );
          if (stopped) return;
          publish();
        }
      } finally {
        await iterator?.return?.();
      }
    };
    const schedule = () => {
      if (stopped) return;
      while (active < DISK_CONCURRENCY && next < queue.length) {
        const item = queue[next]!;
        queue[next++] = undefined;
        if (next >= 1024 && next * 2 >= queue.length) {
          queue.splice(0, next);
          next = 0;
        }
        active++;
        void visit(item)
          .catch(fail)
          .finally(() => {
            active--;
            schedule();
          })
          .catch(fail);
      }
      if (active === 0 && next === queue.length) finish('completed');
    };
    const prepare = async () => {
      if (isProtected(root)) {
        throw Object.assign(new Error('Protected disk root'), {
          code: 'EACCES',
        });
      }
      const rootStats = await fs.lstat(root, work.signal);
      if (stopped) return;
      if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
        throw Object.assign(new Error('Disk root is not a directory'), {
          code: 'ENOENT',
        });
      }
      const canonical = api.resolve(await fs.realpath(root, work.signal));
      if (stopped) return;
      if (
        toComparable(canonical, platform) !== rootKey ||
        isProtected(canonical)
      ) {
        throw Object.assign(
          new Error('Disk root changed after authorization'),
          { code: 'EACCES' },
        );
      }
      let entries: Dirent[] | undefined;
      if (job.view === 'packages') {
        const targets = await listPackageTargets(root, work.signal, deps);
        if (stopped) return;
        // Không spread mảng lớn vào push (có thể vượt giới hạn số argument).
        for (const row of targets) rows.push(row);
      } else {
        entries = rootEntries = [];
        for await (const entry of fs.entries(root, work.signal)) {
          if (stopped) return;
          entries.push(entry);
          rows.push({
            path: api.join(root, entry.name),
            name: entry.name,
            kind: entry.isSymbolicLink()
              ? 'link'
              : entry.isDirectory()
                ? 'directory'
                : 'file',
            canonicalPath: null,
            aliases: [],
            state: 'pending',
            sizeBytes: null,
            fileCount: null,
            reason: null,
          });
        }
      }
      if (stopped) return;
      for (const row of rows) {
        const bucket = makeBucket(row);
        buckets.push(bucket);
        if (row.state === 'excluded') {
          incomplete = true;
          job.progress.skippedCount++;
        } else if (job.view === 'directory') {
          directRows.set(toComparable(row.path, platform), bucket);
        } else if (row.canonicalPath) {
          const key = toComparable(row.canonicalPath, platform);
          const targets = packageTargets.get(key) ?? [];
          targets.push(bucket);
          packageTargets.set(key, targets);
        }
      }
      job.stopReason = rows.length > DISK_ROW_LIMIT ? 'row_limit' : null;
      publish(true);
      if (stopped) return;
      job.phase = 'measuring';
      visitedDirectories.add(rootKey);
      queue.push({ path: canonical, buckets: [], entries, root: true });
      schedule();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else void prepare().catch(fail);
  });
