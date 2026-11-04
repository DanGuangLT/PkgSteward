import type {
  GlobalActivityDto,
  GlobalVersionsDto,
} from '@/global-packages/dto/global-activity.dto';
import type { GlobalPreviewDto } from '@/global-packages/dto/global-preview.dto';
import type { GlobalExecuteDto } from '@/global-packages/dto/global-execute.dto';
import type { GlobalJobIdDto } from '@/global-packages/dto/global-job-id.dto';
import type { GlobalLogQueryDto } from '@/global-packages/dto/global-log-query.dto';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  IGlobalJob,
  IGlobalJobStart,
  IGlobalLogPage,
  IGlobalSnapshot,
} from '@/global-packages/interfaces/global-packages.types';

// Payload contracts; the shared interceptor supplies the unchanged envelope.
export interface IGlobalPackagesController {
  getSnapshot(): IGlobalSnapshot | null;
  inventory(input: GlobalActivityDto): Promise<IGlobalJobStart>;
  versions(input: GlobalVersionsDto): Promise<IGlobalJobStart>;
  preview(input: GlobalPreviewDto): Promise<IGlobalJobStart>;
  execute(input: GlobalExecuteDto): Promise<IGlobalJobStart>;
  getLatest(): IGlobalJob | null;
  getJob(params: GlobalJobIdDto): IGlobalJob;
  getLogs(params: GlobalJobIdDto, query: GlobalLogQueryDto): IGlobalLogPage;
  cancel(params: GlobalJobIdDto): Promise<IGlobalJob>;
}

// HTTP adapter contract preserves the original payload-only contract for callers.
export interface IGlobalPackagesHttpController {
  getSnapshot(): IApiResponse<IGlobalSnapshot | null>;
  inventory(input: GlobalActivityDto): Promise<IApiResponse<IGlobalJobStart>>;
  versions(input: GlobalVersionsDto): Promise<IApiResponse<IGlobalJobStart>>;
  preview(input: GlobalPreviewDto): Promise<IApiResponse<IGlobalJobStart>>;
  execute(input: GlobalExecuteDto): Promise<IApiResponse<IGlobalJobStart>>;
  getLatest(): IApiResponse<IGlobalJob | null>;
  getJob(params: GlobalJobIdDto): IApiResponse<IGlobalJob>;
  getLogs(
    params: GlobalJobIdDto,
    query: GlobalLogQueryDto,
  ): IApiResponse<IGlobalLogPage>;
  cancel(params: GlobalJobIdDto): Promise<IApiResponse<IGlobalJob>>;
}
