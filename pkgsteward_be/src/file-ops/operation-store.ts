import type { IFileOpsOperation } from '@/file-ops/interfaces/file-ops.types';

export const OPERATION_TERMINAL_LIMIT = 16;

/** In-memory operation snapshots for polling, cancellation and execute replay. */
export class OperationStore {
  create(_operation: IFileOpsOperation): void {
    throw new Error('not implemented');
  }

  get(_operationId: string): IFileOpsOperation | undefined {
    throw new Error('not implemented');
  }

  update(_operationId: string, _operation: IFileOpsOperation): void {
    throw new Error('not implemented');
  }
}
