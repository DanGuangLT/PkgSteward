import type {
  IPmContext,
  IPmExecuteRequest,
  IPmJob,
  IPmJobStart,
  IPmPreviewRequest,
  IPmVersionsRequest,
} from '@/package-managers/interfaces/pm.types';

export interface IPackageManagersService {
  getProject(path: string): Promise<IPmContext>;
  versions(input: IPmVersionsRequest): Promise<IPmJobStart>;
  preview(input: IPmPreviewRequest): Promise<IPmJobStart>;
  execute(input: IPmExecuteRequest): Promise<IPmJobStart>;
  // HTTP awaits preflight while the provisional job is already pollable.
  waitForPreflight(id: string): Promise<void>;
  getLatest(): IPmJob | null;
  getJob(id: string): IPmJob;
  cancel(id: string): Promise<IPmJob>;
}
