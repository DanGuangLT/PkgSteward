import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  IDiskUsageActiveJob,
  IDiskUsageJob,
  IDiskUsageStart,
  IStartDiskUsage,
} from '@/disk-usage/interfaces/disk-usage.types';

export interface IDiskUsageController {
  start(input: IStartDiskUsage): Promise<IApiResponse<IDiskUsageStart>>;
  getActive(): IApiResponse<IDiskUsageActiveJob | null>;
  get(params: { jobId: string }): IApiResponse<IDiskUsageJob>;
  cancel(params: { jobId: string }): IApiResponse<IDiskUsageJob>;
}
