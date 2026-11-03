import type { IFileOpsOperation } from '@/file-ops/interfaces/file-ops.types';
import { OperationStore } from '@/file-ops/operation-store';

// TEST fixtures only; not business requirements.
function operation(operationId: string): IFileOpsOperation {
  return {
    operationId,
    previewId: `TEST-preview-${operationId}`,
    status: 'running',
    currentPath: null,
    results: [
      {
        path: 'D:\\TEST-app\\node_modules',
        kind: 'node_modules',
        method: 'permanent',
        status: 'pending',
        errorCode: null,
        mayBePartial: false,
        reclaimableBytes: 70,
      },
    ],
    startedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('OperationStore', () => {
  it('returns undefined for unknown IDs', () => {
    expect(new OperationStore().get('TEST-missing')).toBeUndefined();
  });

  it('isolates nested data on create, read and update', () => {
    const store = new OperationStore();
    const input = operation('TEST-one');
    store.create(input);
    input.results[0].path = 'TEST-mutated';
    const first = store.get('TEST-one')!;
    expect(first.results[0].path).toBe('D:\\TEST-app\\node_modules');
    first.results[0].status = 'running';
    first.currentPath = first.results[0].path;
    expect(store.get('TEST-one')!.results[0].status).toBe('pending');
    store.update('TEST-one', first);
    first.results[0].status = 'failed';
    first.results.length = 0;
    expect(store.get('TEST-one')).toMatchObject({
      currentPath: 'D:\\TEST-app\\node_modules',
      results: [{ status: 'running', errorCode: null }],
    });
  });

  it('evicts the oldest finished operation and keeps running and stopping jobs', () => {
    const store = new OperationStore();
    store.create(operation('TEST-running'));
    store.create({ ...operation('TEST-stopping'), status: 'stopping' });
    for (let i = 0; i < 17; i++) {
      const row = operation(`TEST-${i}`);
      store.create(row);
      store.update(row.operationId, {
        ...row,
        status: (['completed', 'cancelled', 'failed'] as const)[i % 3],
        finishedAt:
          i === 5
            ? '2026-10-01T00:00:00.000Z'
            : new Date(Date.UTC(2026, 9, 2, 0, i)).toISOString(),
      });
    }
    expect(store.get('TEST-5')).toBeUndefined();
    expect(
      Array.from({ length: 17 }, (_, i) => store.get(`TEST-${i}`)).filter(
        Boolean,
      ),
    ).toHaveLength(16);
    expect(store.get('TEST-0')!.status).toBe('completed');
    expect(store.get('TEST-running')!.status).toBe('running');
    expect(store.get('TEST-stopping')!.status).toBe('stopping');
  });

  it('also enforces retention when terminal records are created directly', () => {
    const store = new OperationStore();
    for (let i = 16; i >= 0; i--) {
      store.create({
        ...operation(`TEST-${i}`),
        status: 'completed',
        finishedAt: new Date(Date.UTC(2026, 9, 2, 0, i)).toISOString(),
      });
    }
    expect(store.get('TEST-0')).toBeUndefined();
    expect(store.get('TEST-1')!.status).toBe('completed');
    expect(store.get('TEST-16')!.status).toBe('completed');
  });
});
