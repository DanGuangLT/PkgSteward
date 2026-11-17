import type { ClearRecoveryHoldDto } from '@/npm-runner/dto/clear-recovery-hold.dto';
import type { RunnerPathQueryDto } from '@/npm-runner/dto/runner-path-query.dto';
import type { StartNpmRunDto } from '@/npm-runner/dto/start-npm-run.dto';
import type { RunIdParamDto } from '@/npm-runner/dto/run-id-param.dto';
import type { RunLogQueryDto } from '@/npm-runner/dto/run-log-query.dto';
import type { Response } from 'express';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type {
  IRecoveryClearResult,
  IRunJob,
  IRunLogPage,
  IRunStart,
  IRunnerContext,
  RunLatestResult,
} from '@/npm-runner/interfaces/npm-runner.types';

export interface INpmRunnerController {
  context(query: RunnerPathQueryDto): Promise<IApiResponse<IRunnerContext>>;
  start(body: StartNpmRunDto): Promise<IApiResponse<IRunStart>>;
  latest(): IApiResponse<RunLatestResult>;
  clearRecovery(
    body: ClearRecoveryHoldDto,
  ): Promise<IApiResponse<IRecoveryClearResult>>;
  get(params: RunIdParamDto): IApiResponse<IRunJob>;
  logs(params: RunIdParamDto, query: RunLogQueryDto): IApiResponse<IRunLogPage>;
  cancel(
    params: RunIdParamDto,
    response: Response,
  ): Promise<IApiResponse<IRunJob>>;
}
