import type {
  IGlobalActivityRequest,
  IGlobalExecuteRequest,
  IGlobalJob,
  IGlobalJobStart,
  IGlobalLogPage,
  IGlobalPreviewRequest,
  IGlobalSnapshot,
  IGlobalVersionsRequest,
} from '@/global-packages/interfaces/global-packages.types';

export interface IGlobalPackagesService {
  getSnapshot(): IGlobalSnapshot | null;
  inventory(input: IGlobalActivityRequest): Promise<IGlobalJobStart>;
  versions(input: IGlobalVersionsRequest): Promise<IGlobalJobStart>;
  preview(input: IGlobalPreviewRequest): Promise<IGlobalJobStart>;
  execute(input: IGlobalExecuteRequest): Promise<IGlobalJobStart>;
  // HTTP waits for fresh-facts validation while provisional jobs remain pollable.
  waitForPreflight?(id: string): Promise<void>;
  getLatest(): IGlobalJob | null;
  getJob(id: string): IGlobalJob;
  getLogs(id: string, cursor: number): IGlobalLogPage;
  cancel(id: string): Promise<IGlobalJob>;
}
