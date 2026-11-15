import type {
  IDiskUsageActiveJob,
  IDiskUsageJob,
  IDiskUsageStart,
  IStartDiskUsage,
  ICompletedDiskSize,
} from '@/disk-usage/interfaces/disk-usage.types';

export interface IDiskUsageService {
  hasRunningMeasurement(): boolean;
  start(input: IStartDiskUsage): Promise<IDiskUsageStart>;
  getActive(): IDiskUsageActiveJob | null;
  get(jobId: string): IDiskUsageJob;
  cancel(jobId: string): IDiskUsageJob;
  peekCompletedSize(canonicalPath: string): ICompletedDiskSize | null;
  clearCache(): void;
}
