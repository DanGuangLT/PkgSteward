import type {
  GlobalActivityDto,
  GlobalVersionsDto,
} from '@/global-packages/dto/global-activity.dto';
import type { GlobalPreviewDto } from '@/global-packages/dto/global-preview.dto';
import type { GlobalExecuteDto } from '@/global-packages/dto/global-execute.dto';
import type { GlobalJobIdDto } from '@/global-packages/dto/global-job-id.dto';
import type { GlobalLogQueryDto } from '@/global-packages/dto/global-log-query.dto';
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
