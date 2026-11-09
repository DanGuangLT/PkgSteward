import { AppException } from '@/common/exceptions/app.exception';
import type { IFileOpsPreview } from '@/file-ops/interfaces/file-ops.types';
import {
  PreviewStore,
  type IPreviewRecord,
} from '@/file-ops/stores/preview-store';

// TEST fixtures only; not business requirements.
function record(
  previewId: string,
  startedAt = '2026-10-01T00:00:00.000Z',
): IPreviewRecord {
  return {
    preview: {
      previewId,
      source: 'delete',
      status: 'running',
      scanId: 'TEST-scan',
      progress: { measuredTargets: 0, totalTargets: 1 },
      targets: [
        {
          path: 'D:\\TEST-app\\node_modules',
          kind: 'node_modules',
          method: 'permanent',
          valid: true,
          failureCode: null,
          owner: { path: 'D:\\TEST-app', name: 'TEST-app' },
          nestedProjects: ['D:\\TEST-app\\node_modules\\TEST-child'],
          hasLockfile: true,
          lastActivityAt: '2026-09-01T00:00:00.000Z',
          size: {
            status: 'done',
            apparentBytes: 120,
            sizeBytes: 100,
            reclaimableBytes: 70,
            sharedBytes: 30,
            fileCount: 2,
          },
          risk: {
            level: 'medium',
            reasons: [
              {
                code: 'RECENTLY_ACTIVE',
                level: 'medium',
                message: 'TEST recent',
              },
            ],
          },
          defaultSelected: true,
        },
      ],
      risk: {
        level: 'medium',
        reasons: [
          { code: 'RECENTLY_ACTIVE', level: 'medium', message: 'TEST recent' },
        ],
      },
      confirmText: null,
      operationId: null,
      startedAt,
      failureCode: null,
    },
    identities: new Map([
      [
        'D:\\TEST-app\\node_modules',
        { dev: '7', ino: '9007199254740993', type: 'directory' },
      ],
    ]),
    measurements: new Map([
      [
        'D:\\TEST-app\\node_modules',
        {
          apparentBytes: 120,
          sizeBytes: 100,
          reclaimableBytes: 70,
          sharedBytes: 30,
          fileCount: 2,
        },
      ],
    ]),
    controller: new AbortController(),
  };
}

function finish(
  store: PreviewStore,
  source: IPreviewRecord,
  finishedAt: string,
  status: 'completed' | 'failed' | 'cancelled' = 'completed',
) {
  const preview: IFileOpsPreview = {
    ...source.preview,
    status,
    finishedAt,
    failureCode: status === 'failed' ? 'INTERNAL_ERROR' : null,
  };
  store.update(preview.previewId, preview);
  return preview;
}

describe('PreviewStore', () => {
  it.each(['completed', 'cancelled', 'failed'] as const)(
    'attaches an operation to a %s preview without changing its facts',
    (status) => {
      const store = new PreviewStore();
      const source = record('TEST-attach');
      store.create(source);
      const terminal = finish(
        store,
        source,
        '2026-10-02T00:00:00.000Z',
        status,
      );
      const facts = store.getFacts('TEST-attach');
      store.attachOperation('TEST-attach', 'TEST-operation');
      expect(store.get('TEST-attach')).toEqual({
        ...terminal,
        operationId: 'TEST-operation',
      });
      expect(store.getFacts('TEST-attach')).toEqual(facts);
      // Delayed preview publication cannot remove the attached operation.
      store.update('TEST-attach', source.preview);
      expect(store.get('TEST-attach')!.operationId).toBe('TEST-operation');
    },
  );

  it('rejects a second attachment and preserves the original operation', () => {
    const store = new PreviewStore();
    const source = record('TEST-attach');
    store.create(source);
    finish(store, source, '2026-10-02T00:00:00.000Z');
    store.attachOperation('TEST-attach', 'TEST-first');
    expect(() => store.attachOperation('TEST-attach', 'TEST-second')).toThrow(
      Error,
    );
    expect(store.get('TEST-attach')!.operationId).toBe('TEST-first');
  });

  it('rejects missing and running previews without reserving an operation', () => {
    const store = new PreviewStore();
    expect(() => store.attachOperation('TEST-attach', 'TEST-missing')).toThrow(
      Error,
    );
    expect(store.get('TEST-attach')).toBeUndefined();
    const source = record('TEST-attach');
    store.create(source);
    expect(() => store.attachOperation('TEST-attach', 'TEST-running')).toThrow(
      Error,
    );
    expect(store.get('TEST-attach')!.operationId).toBeNull();
    finish(store, source, '2026-10-02T00:00:00.000Z');
    store.attachOperation('TEST-attach', 'TEST-final');
    expect(store.get('TEST-attach')!.operationId).toBe('TEST-final');
  });

  it('allows one running record and rejects a second without losing the first', () => {
    const store = new PreviewStore();
    const first = record('TEST-first');
    store.create(first);
    expect(store.hasRunningPreview()).toBe(true);
    let error: unknown;
    try {
      store.create(record('TEST-second'));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(store.get('TEST-first')).toEqual(first.preview);
    expect(store.get('TEST-second')).toBeUndefined();
  });

  it.each(['completed', 'cancelled', 'failed'] as const)(
    'releases the running slot after %s',
    (status) => {
      const store = new PreviewStore();
      const first = record('TEST-first');
      store.create(first);
      finish(store, first, '2026-10-02T00:00:00.000Z', status);
      expect(store.hasRunningPreview()).toBe(false);
      store.create(record('TEST-second'));
      expect(store.hasRunningPreview()).toBe(true);
      expect(store.get('TEST-first')?.status).toBe(status);
    },
  );

  it('retains sixteen terminals by finish time, not creation or insertion order', () => {
    const store = new PreviewStore();
    for (let i = 0; i < 17; i++) {
      const source = record(`TEST-${i}`);
      store.create(source);
      // TEST-5 finishes first even though it is inserted after TEST-0.
      const time =
        i === 5
          ? '2026-10-01T00:00:00.000Z'
          : new Date(Date.UTC(2026, 9, 2, 0, i)).toISOString();
      finish(store, source, time, i % 2 ? 'cancelled' : 'completed');
    }
    expect(store.get('TEST-5')).toBeUndefined();
    expect(store.getFacts('TEST-5')).toBeUndefined();
    expect(
      Array.from({ length: 17 }, (_, i) => store.get(`TEST-${i}`)).filter(
        Boolean,
      ),
    ).toHaveLength(16);
    store.create(record('TEST-running'));
    expect(store.get('TEST-running')?.status).toBe('running');
    expect(store.get('TEST-0')?.status).toBe('completed');
  });

  it('deep-clones public reads and never exposes internal facts or abort control', () => {
    const store = new PreviewStore();
    const source = record('TEST-one');
    store.create(source);
    const copy = store.get('TEST-one')!;
    copy.targets[0].size.sizeBytes = 999;
    copy.targets[0].owner!.name = 'changed';
    copy.targets[0].nestedProjects.length = 0;
    copy.targets[0].risk.reasons.length = 0;
    copy.risk.reasons[0].message = 'changed';
    copy.progress.totalTargets = 999;
    expect(store.get('TEST-one')).toEqual(source.preview);
    expect(Object.keys(store.get('TEST-one')!).sort()).toEqual(
      Object.keys(source.preview).sort(),
    );
    expect(JSON.stringify(store.get('TEST-one'))).not.toContain(
      '9007199254740993',
    );
  });

  it('keeps full measurement and identity facts for preflight as separate clones', () => {
    const store = new PreviewStore();
    const source = record('TEST-one');
    store.create(source);
    const facts = store.getFacts('TEST-one')!;
    expect(facts).toEqual({
      identities: source.identities,
      measurements: source.measurements,
    });
    facts.identities.values().next().value!.ino = 'changed';
    facts.measurements.values().next().value!.apparentBytes = 999;
    expect(store.getFacts('TEST-one')).toEqual({
      identities: source.identities,
      measurements: source.measurements,
    });
  });

  it('copies data on create and update so caller changes cannot alter retained records', () => {
    const store = new PreviewStore();
    const source = record('TEST-one');
    store.create(source);
    source.preview.targets.length = 0;
    source.identities.clear();
    source.measurements.clear();
    expect(store.get('TEST-one')?.targets).toHaveLength(1);
    expect(store.getFacts('TEST-one')?.identities.size).toBe(1);
    const preview = store.get('TEST-one')!;
    preview.progress.measuredTargets = 1;
    const facts = store.getFacts('TEST-one')!;
    store.update('TEST-one', preview, facts);
    preview.progress.measuredTargets = 100;
    facts.measurements.clear();
    expect(store.get('TEST-one')?.progress.measuredTargets).toBe(1);
    expect(store.getFacts('TEST-one')?.measurements.size).toBe(1);
  });

  it('does not accept a late running update after a record becomes terminal', () => {
    const store = new PreviewStore();
    const source = record('TEST-one');
    store.create(source);
    const terminal = finish(
      store,
      source,
      '2026-10-02T00:00:00.000Z',
      'cancelled',
    );
    store.update('TEST-one', source.preview, {
      identities: new Map(),
      measurements: new Map(),
    });
    expect(store.get('TEST-one')).toEqual(terminal);
    expect(store.getFacts('TEST-one')?.identities.size).toBe(1);
  });

  it('aborts the retained controller without exposing it in read results', () => {
    const store = new PreviewStore();
    const source = record('TEST-one');
    store.create(source);
    store.abort('TEST-one');
    expect(source.controller.signal.aborted).toBe(true);
    expect(store.get('TEST-one')).not.toHaveProperty('controller');
    expect(store.getFacts('TEST-one')).not.toHaveProperty('controller');
  });

  it('returns undefined for an unknown public record or internal facts', () => {
    const store = new PreviewStore();
    expect(store.get('TEST-missing')).toBeUndefined();
    expect(store.getFacts('TEST-missing')).toBeUndefined();
  });
});
