import { randomUUID } from 'node:crypto';
import { toComparable } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import type { ScanRoots } from '@/config/scan-roots';
import type {
  IOrphanNodeModules,
  IScanCacheDeps,
  IScanCacheEntry,
  IScanCacheKey,
  IScannedProject,
  IScanResult,
} from '@/scanner/interfaces/scanner.types';

export function makeScanCacheKey(
  roots: ScanRoots,
  maxDepth: number,
  platform: PathPlatform,
): IScanCacheKey {
  return {
    roots:
      roots.kind === 'all-fixed-drives'
        ? '*'
        : [
            ...new Set(roots.paths.map((root) => toComparable(root, platform))),
          ].sort(),
    maxDepth,
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(text);
const isoDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
};
const validKey = (value: unknown): value is IScanCacheKey =>
  record(value) &&
  (value.roots === '*' || strings(value.roots)) &&
  count(value.maxDepth);
const validProject = (value: unknown): value is IScannedProject =>
  record(value) &&
  text(value.path) &&
  (value.name === null || text(value.name)) &&
  (value.packageManager === null ||
    (typeof value.packageManager === 'string' &&
      ['pnpm', 'yarn', 'npm'].includes(value.packageManager))) &&
  typeof value.hasLockfile === 'boolean' &&
  isoDate(value.lastActivityAt) &&
  record(value.nodeModules) &&
  typeof value.nodeModules.exists === 'boolean' &&
  text(value.nodeModules.path) &&
  value.nodeModules.sizeBytes === null;
const validOrphan = (value: unknown): value is IOrphanNodeModules =>
  record(value) &&
  text(value.path) &&
  value.sizeBytes === null &&
  isoDate(value.mtime);
const validResult = (value: unknown): value is IScanResult =>
  record(value) &&
  typeof value.scanId === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.scanId,
  ) &&
  (value.status === 'completed' || value.status === 'timed_out') &&
  value.partial === (value.status === 'timed_out') &&
  strings(value.roots) &&
  count(value.maxDepth) &&
  isoDate(value.startedAt) &&
  isoDate(value.finishedAt) &&
  value.finishedAt >= value.startedAt &&
  count(value.skippedCount) &&
  Array.isArray(value.projects) &&
  value.projects.every(validProject) &&
  Array.isArray(value.orphanNodeModules) &&
  value.orphanNodeModules.every(validOrphan);
const sameKey = (a: IScanCacheKey, b: IScanCacheKey) =>
  a.maxDepth === b.maxDepth &&
  JSON.stringify(a.roots) === JSON.stringify(b.roots);
const validEntry = (value: unknown): value is IScanCacheEntry =>
  record(value) &&
  value.schemaVersion === 1 &&
  validKey(value.key) &&
  validResult(value.result) &&
  value.key.maxDepth === value.result.maxDepth;

export class ScannerCache {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly deps: IScanCacheDeps) {}

  async load(key: IScanCacheKey): Promise<IScanCacheEntry | null> {
    try {
      const value: unknown = JSON.parse(
        await this.deps.fs.readFile(this.deps.cacheFilePath),
      );
      if (!validEntry(value) || !sameKey(value.key, key)) {
        this.deps.warn('Ignoring invalid or mismatched scan cache');
        return null;
      }
      return value;
    } catch (error) {
      if (!record(error) || error.code !== 'ENOENT') {
        this.deps.warn('Could not load scan cache', error);
      }
      return null;
    }
  }

  save(entry: IScanCacheEntry): Promise<void> {
    const content = JSON.stringify(entry);
    this.pending = this.pending.then(async () => {
      let temp: string | undefined;
      try {
        await this.deps.ensureCacheDir();
        // Temp riêng cùng thư mục để rename nguyên tử và không xoá nhầm lần ghi khác.
        temp = `${this.deps.cacheFilePath}.${randomUUID()}.tmp`;
        await this.deps.fs.writeFile(temp, content);
        await this.deps.fs.rename(temp, this.deps.cacheFilePath);
      } catch (error) {
        this.deps.warn('Could not save scan cache', error);
      } finally {
        if (temp) {
          try {
            await this.deps.fs.unlink(temp);
          } catch (error) {
            if (!record(error) || error.code !== 'ENOENT') {
              this.deps.warn('Could not clean up scan cache temp file', error);
            }
          }
        }
      }
    });
    return this.pending;
  }

  async flush(): Promise<void> {
    await this.pending;
  }
}
