import type {
  IRecoveryClearRequest,
  IRecoveryClearResult,
  IRunJob,
  IRunLogPage,
  IRunRequest,
  IRunStart,
  IRunnerContext,
  RunLatestResult,
} from '@/npm-runner/interfaces/npm-runner.types';

export interface INpmRunnerService {
  context(path: string): Promise<IRunnerContext>;
  start(input: IRunRequest): Promise<IRunStart>;
  latest(): RunLatestResult;
  clearRecovery(body: IRecoveryClearRequest): Promise<IRecoveryClearResult>;
  get(id: string): IRunJob;
  logs(id: string, cursor: number): IRunLogPage;
  cancel(id: string): Promise<IRunJob>;
}
