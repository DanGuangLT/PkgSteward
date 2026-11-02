import type {
  IProjectAnalysisJob,
  IProjectAnalysisStart,
  IProjectDetail,
} from '@/projects/interfaces/projects.types';

// Structural return contract; runtime controller uses the shared API envelope.
interface IProjectResponse<T> {
  statusCode: number;
  message: string;
  data: T;
}
export interface IProjectsController {
  detail(query: { path: string }): Promise<IProjectResponse<IProjectDetail>>;
  start(input: {
    path: string;
  }): Promise<IProjectResponse<IProjectAnalysisStart>>;
  get(params: { jobId: string }): IProjectResponse<IProjectAnalysisJob>;
  cancel(params: { jobId: string }): IProjectResponse<IProjectAnalysisJob>;
}
