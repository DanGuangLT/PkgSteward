import type { RunnerPathQueryDto } from '../dto/runner-path-query.dto';
import type { StartNpmRunDto } from '../dto/start-npm-run.dto';
import type { RunIdParamDto } from '../dto/run-id-param.dto';
import type { RunLogQueryDto } from '../dto/run-log-query.dto';
import type {
  IRunJob,
  IRunLogPage,
  IRunStart,
  IRunnerContext,
} from './npm-runner.types';

export interface INpmRunnerController {
  context(query: RunnerPathQueryDto): Promise<IRunnerContext>;
  start(body: StartNpmRunDto): Promise<IRunStart>;
  latest(): IRunJob;
  get(params: RunIdParamDto): IRunJob;
  logs(params: RunIdParamDto, query: RunLogQueryDto): IRunLogPage;
  cancel(params: RunIdParamDto): Promise<IRunJob>;
}
