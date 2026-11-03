import type {
  IProjectAnalysisJob,
  IProjectAnalysisStart,
  IProjectDetail,
} from '@/projects/interfaces/projects.types';

export interface IProjectsService {
  detail(path: string): Promise<IProjectDetail>;
  start(input: { path: string }): Promise<IProjectAnalysisStart>;
  get(jobId: string): IProjectAnalysisJob;
  cancel(jobId: string): IProjectAnalysisJob;
  hasRunningAnalysis(): boolean;
  invalidateAfterMutation(path: string): void;
}
