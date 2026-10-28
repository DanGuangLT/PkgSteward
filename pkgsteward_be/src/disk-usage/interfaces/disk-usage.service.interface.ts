import type {
  IDiskUsageJob,
  IDiskUsageStart,
  IStartDiskUsage,
  ICompletedDiskSize,
} from '@/disk-usage/interfaces/disk-usage.types';

export interface IDiskUsageService {
  hasRunningMeasurement(): boolean;
  start(input: IStartDiskUsage): Promise<IDiskUsageStart>;
  get(jobId: string): IDiskUsageJob;
  cancel(jobId: string): IDiskUsageJob;
  peekCompletedSize(canonicalPath: string): ICompletedDiskSize | null;
}
