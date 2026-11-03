import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  IProjectAnalysisJob,
  IProjectAnalysisStart,
  IProjectDetail,
} from '@/projects/interfaces/projects.types';

export interface IProjectsController {
  detail(query: { path: string }): Promise<IApiResponse<IProjectDetail>>;
  start(input: { path: string }): Promise<IApiResponse<IProjectAnalysisStart>>;
  get(params: { jobId: string }): IApiResponse<IProjectAnalysisJob>;
  cancel(params: { jobId: string }): IApiResponse<IProjectAnalysisJob>;
}
