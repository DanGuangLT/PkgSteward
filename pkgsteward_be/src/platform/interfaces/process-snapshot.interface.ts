export const PROCESS_SNAPSHOT = Symbol('PROCESS_SNAPSHOT');

export interface IProcessInfo {
  pid: number;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
}

export type ProcessSnapshotResult =
  | { status: 'ok'; processes: IProcessInfo[] }
  | { status: 'unknown'; reason: string };

export interface IProcessSnapshot {
  /** Captures process metadata without throwing or logging command lines. */
  capture(): Promise<ProcessSnapshotResult>;
}
