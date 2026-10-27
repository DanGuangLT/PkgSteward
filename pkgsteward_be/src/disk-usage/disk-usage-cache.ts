import { Injectable } from '@nestjs/common';
import { toComparable, toPathPlatform } from '@/common/utils/path.util';
import type {
  DiskView,
  ICompletedDiskSize,
  IDiskUsageJob,
} from '@/disk-usage/interfaces/disk-usage.types';

interface ICacheEntry {
  path: string;
  rootMtimeNs: bigint;
  job: IDiskUsageJob;
}

@Injectable()
export class DiskUsageCache {
  private readonly platform = toPathPlatform();
  private readonly entries = new Map<string, ICacheEntry>();

  private key(path: string, view: DiskView): string {
    return JSON.stringify([toComparable(path, this.platform), view]);
  }

  get(path: string, view: DiskView, rootMtimeNs: bigint): IDiskUsageJob | null {
    const key = this.key(path, view);
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    if (entry.rootMtimeNs !== rootMtimeNs) return null;
    this.entries.set(key, entry);
    return structuredClone(entry.job);
  }

  put(job: IDiskUsageJob, rootMtimeNs: bigint): void {
    if (job.status !== 'completed' || job.partial || job.stopReason !== null) {
      return;
    }
    const snapshot = structuredClone(job);
    for (const row of snapshot.children) {
      Object.freeze(row.aliases);
      Object.freeze(row);
    }
    Object.freeze(snapshot.children);
    Object.freeze(snapshot.progress);
    Object.freeze(snapshot);
    const key = this.key(job.path, job.view);
    this.entries.delete(key);
    this.entries.set(key, {
      path: toComparable(job.path, this.platform),
      rootMtimeNs,
      job: snapshot,
    });
    if (this.entries.size > 64) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  peekCompletedSize(path: string): ICompletedDiskSize | null {
    const comparable = toComparable(path, this.platform);
    let latest: ICompletedDiskSize | null = null;
    for (const entry of this.entries.values()) {
      const { sizeBytes, measuredAt } = entry.job;
      if (
        entry.path === comparable &&
        sizeBytes !== null &&
        measuredAt !== null &&
        (!latest || measuredAt >= latest.measuredAt)
      ) {
        latest = { sizeBytes, measuredAt };
      }
    }
    return latest;
  }

  clear(): void {
    this.entries.clear();
  }
}
