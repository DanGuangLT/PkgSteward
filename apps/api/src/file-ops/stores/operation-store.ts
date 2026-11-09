import type { IFileOpsOperation } from '@/file-ops/interfaces/file-ops.types';

export const OPERATION_TERMINAL_LIMIT = 16;

/** In-memory operation snapshots for polling, cancellation and execute replay. */
export class OperationStore {
  private readonly records = new Map<string, IFileOpsOperation>();

  create(operation: IFileOpsOperation): void {
    this.records.set(operation.operationId, structuredClone(operation));
    this.trimTerminals();
  }

  get(operationId: string): IFileOpsOperation | undefined {
    const operation = this.records.get(operationId);
    return operation ? structuredClone(operation) : undefined;
  }

  update(operationId: string, operation: IFileOpsOperation): void {
    if (!this.records.has(operationId)) return;
    this.records.set(operationId, structuredClone(operation));
    this.trimTerminals();
  }

  private trimTerminals(): void {
    const terminals = [...this.records.values()]
      .filter(({ status }) => status !== 'running' && status !== 'stopping')
      .sort(
        (a, b) =>
          Date.parse(a.finishedAt ?? a.startedAt) -
          Date.parse(b.finishedAt ?? b.startedAt),
      );
    const excess = Math.max(0, terminals.length - OPERATION_TERMINAL_LIMIT);
    for (const operation of terminals.slice(0, excess)) {
      this.records.delete(operation.operationId);
    }
  }
}
