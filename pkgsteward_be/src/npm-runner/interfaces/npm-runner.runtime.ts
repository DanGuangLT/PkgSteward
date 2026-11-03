import type {
  IRunJob,
  IRunnerCommand,
  IRunnerInputDeps,
} from './npm-runner.types';

export interface IRunnerProcess {
  pid: number | null;
  settled: Promise<{ exitCode: number | null; signal: string | null }>;
  stop(): Promise<{ terminationVerified: boolean }>;
}
export interface IRunnerLaunchCallbacks {
  signal: AbortSignal;
  onOutput(stream: 'stdout' | 'stderr', bytes: Buffer): void;
  onExit(exitCode: number | null, signal: string | null): void;
}
// Structural seams keep the runner independent of existing services' implementations.
export interface INpmRunnerRuntime {
  input: IRunnerInputDeps;
  env: Readonly<NodeJS.ProcessEnv>;
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
  appPaths: { ensureCacheDir(): Promise<string> };
  launch(
    command: IRunnerCommand,
    env: NodeJS.ProcessEnv,
    callbacks: IRunnerLaunchCallbacks,
  ): IRunnerProcess;
  now(): Date;
  uuid(): string;
  setTimer(
    callback: () => void,
    milliseconds: number,
  ): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}
