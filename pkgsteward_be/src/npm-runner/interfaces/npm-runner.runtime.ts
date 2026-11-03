import type {
  IRunJob,
  IRunnerCommand,
  IRunnerInputDeps,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunProcess,
  IRunProcessCallbacks,
} from '@/npm-runner/runner-process';
import type { IWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';

export const NPM_RUNNER_RUNTIME = Symbol('NPM_RUNNER_RUNTIME');
export const NPM_RUNNER_FS = Symbol('NPM_RUNNER_FS');
export const NPM_RUNNER_PROCESS = Symbol('NPM_RUNNER_PROCESS');
// Structural seams keep the runner independent of existing services' implementations.
export interface INpmRunnerRuntime {
  input: IRunnerInputDeps;
  env: Readonly<NodeJS.ProcessEnv>;
  processes: IWindowsRunnerProcess | null;
  timeoutMs: number | undefined;
  gate: { tryEnter(): symbol | null; leave(token: symbol): void };
  readers: {
    hasRunningScan(): boolean;
    hasRunningMeasurement(): boolean;
    hasRunningPreview(): boolean;
    hasRunningAnalysis(): boolean;
  };
  audit: {
    writeIntent(job: Readonly<IRunJob>): Promise<void>;
    writeResult(job: Readonly<IRunJob>): Promise<void>;
  };
  invalidation: {
    refreshProject(path: string): Promise<void>;
    clearDiskUsage(): void;
    staleAnalysis(path: string): void;
  };
  launch(
    command: IRunnerCommand,
    env: NodeJS.ProcessEnv,
    callbacks: IRunProcessCallbacks,
  ): IRunProcess;
  now(): Date;
  uuid(): string;
  setTimer(
    callback: () => void,
    milliseconds: number,
  ): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}
