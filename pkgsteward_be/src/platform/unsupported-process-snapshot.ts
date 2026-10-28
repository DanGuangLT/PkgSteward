import type {
  IProcessSnapshot,
  ProcessSnapshotResult,
} from '@/platform/interfaces/process-snapshot.interface';

export class UnsupportedProcessSnapshot implements IProcessSnapshot {
  capture(): Promise<ProcessSnapshotResult> {
    return Promise.resolve({
      status: 'unknown',
      reason: 'unsupported_platform',
    });
  }
}
