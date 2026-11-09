import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type { PmProjectQueryDto } from '@/package-managers/dto/pm-project-query.dto';
import type { PmVersionsDto } from '@/package-managers/dto/pm-versions.dto';
import type { PmPreviewDto } from '@/package-managers/dto/pm-preview.dto';
import type { PmExecuteDto } from '@/package-managers/dto/pm-execute.dto';
import type { PmJobIdDto } from '@/package-managers/dto/pm-job-id.dto';
import type {
  IPmContext,
  IPmJob,
  IPmJobStart,
} from '@/package-managers/interfaces/pm.types';

export interface IPackageManagersController {
  getProject(query: PmProjectQueryDto): Promise<IApiResponse<IPmContext>>;
  versions(input: PmVersionsDto): Promise<IApiResponse<IPmJobStart>>;
  preview(input: PmPreviewDto): Promise<IApiResponse<IPmJobStart>>;
  execute(input: PmExecuteDto): Promise<IApiResponse<IPmJobStart>>;
  getLatest(): IApiResponse<IPmJob | null>;
  getJob(params: PmJobIdDto): IApiResponse<IPmJob>;
  cancel(params: PmJobIdDto): Promise<IApiResponse<IPmJob>>;
}
