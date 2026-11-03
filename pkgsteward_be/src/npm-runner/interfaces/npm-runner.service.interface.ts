import type {
  IRunJob,
  IRunLogPage,
  IRunRequest,
  IRunStart,
  IRunnerContext,
} from './npm-runner.types';

export interface INpmRunnerService {
  context(path: string): Promise<IRunnerContext>;
  start(input: IRunRequest): Promise<IRunStart>;
  latest(): IRunJob;
  get(id: string): IRunJob;
  logs(id: string, cursor: number): IRunLogPage;
  cancel(id: string): Promise<IRunJob>;
}
