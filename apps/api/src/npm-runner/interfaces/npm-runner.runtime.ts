import type {
  IRunJob,
  IRunnerCommand,
  IRunnerInputDeps,
  NativeShell,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunProcess,
  IRunProcessCallbacks,
} from '@/npm-runner/execution/runner-process';
import type {
  ITerminalRunCallbacks,
  ITerminalRunProcess,
} from '@/npm-runner/terminal/terminal-worker-process';
import type {
  ITerminalIdentity,
  ITerminalSize,
} from '@/npm-runner/terminal/terminal-protocol';
import type {
  INativeInitCommand,
  INativeSessionIdentity,
} from '@/npm-runner/native-session/native-protocol';
import type {
  INativeSession,
  INativeSessionCallbacks,
} from '@/npm-runner/native-session/native-session';
import type {
  INativeConsolePreflight,
  NativePreflightResult,
} from '@/platform/windows/windows-native-console';
import type { IWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';

export const NPM_RUNNER_RUNTIME = Symbol('NPM_RUNNER_RUNTIME');
export const NPM_RUNNER_FS = Symbol('NPM_RUNNER_FS');
export const NPM_RUNNER_PROCESS = Symbol('NPM_RUNNER_PROCESS');
export interface INativeSessionStartInput {
  identity: INativeSessionIdentity;
  fingerprint: string;
  preflight: INativeConsolePreflight;
  init: INativeInitCommand;
  initialTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  writeIntent(): Promise<void>;
  beforeInit?(): Promise<void>;
  callbacks: INativeSessionCallbacks;
}
export interface INativeRunnerRuntime {
  capability(): Promise<boolean>;
  preflight(shell: NativeShell): Promise<NativePreflightResult>;
  createSession(input: INativeSessionStartInput): INativeSession;
}
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
    staleAllAnalyses?(): void;
  };
  launch(
    command: IRunnerCommand,
    env: NodeJS.ProcessEnv,
    callbacks: IRunProcessCallbacks,
  ): IRunProcess;
  launchTerminal?(
    command: IRunnerCommand,
    env: NodeJS.ProcessEnv,
    callbacks: ITerminalRunCallbacks,
    identity: ITerminalIdentity,
    initialSize?: ITerminalSize,
  ): ITerminalRunProcess;
  native?: INativeRunnerRuntime;
  now(): Date;
  uuid(): string;
  setTimer(
    callback: () => void,
    milliseconds: number,
  ): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}
