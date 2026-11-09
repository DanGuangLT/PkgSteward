import {
  deleteTarget,
  PERMANENT_RM_OPTIONS,
} from '@/file-ops/deletion/file-deleter';
import type { IFileDeleterDeps } from '@/file-ops/deletion/file-deleter';
import type {
  DeleteErrorCode,
  FileOpsKind,
  FileOpsMethod,
} from '@/file-ops/interfaces/file-ops.types';
import type { IRecycleBin } from '@/platform/interfaces/recycle-bin.interface';

// TEST fixtures only; deletion dependencies are mocks, never real filesystem IO.
const target = 'D:\\TEST\\target';
const fixture = () => {
  const rm = jest
    .fn<
      ReturnType<IFileDeleterDeps['rm']>,
      Parameters<IFileDeleterDeps['rm']>
    >()
    .mockResolvedValue(undefined);
  const recycle = jest
    .fn<
      ReturnType<IRecycleBin['recycle']>,
      Parameters<IRecycleBin['recycle']>
    >()
    .mockResolvedValue({ status: 'recycled' });
  return { rm, recycle, deps: { rm, recycleBin: { recycle } } };
};

describe('deleteTarget', () => {
  it('freezes the exact permanent deletion options: recursive, no force, no retry', () => {
    expect(PERMANENT_RM_OPTIONS).toEqual({
      recursive: true,
      force: false,
      maxRetries: 0,
    });
    expect(Object.isFrozen(PERMANENT_RM_OPTIONS)).toBe(true);
  });

  it.each<[FileOpsKind, FileOpsMethod]>([
    ['project', 'recycle'],
    ['project_content', 'recycle'],
    ['node_modules', 'permanent'],
    ['orphan_node_modules', 'permanent'],
    ['build_cache', 'permanent'],
  ])('deletes %s once using %s only', async (kind, method) => {
    const f = fixture();
    await expect(
      deleteTarget({ path: target, kind, apparentBytes: 123 }, f.deps),
    ).resolves.toEqual({ method, status: 'success' });
    if (method === 'permanent') {
      expect(f.rm).toHaveBeenCalledTimes(1);
      expect(f.rm).toHaveBeenCalledWith(target, PERMANENT_RM_OPTIONS);
      expect(f.rm.mock.calls[0][1]).toBe(PERMANENT_RM_OPTIONS);
      expect(f.recycle).not.toHaveBeenCalled();
    } else {
      expect(f.recycle).toHaveBeenCalledTimes(1);
      expect(f.recycle).toHaveBeenCalledWith(target, 123);
      expect(f.rm).not.toHaveBeenCalled();
    }
  });

  it.each<[unknown, DeleteErrorCode, boolean]>([
    ['EBUSY', 'FILE_IN_USE', true],
    ['EPERM', 'ACCESS_DENIED', true],
    ['EACCES', 'ACCESS_DENIED', true],
    ['ENOENT', 'TARGET_GONE', false],
    ['ENAMETOOLONG', 'PATH_TOO_LONG', true],
    ['ENOTEMPTY', 'DELETE_FAILED', true],
    ['EIO', 'DELETE_FAILED', true],
    [123, 'DELETE_FAILED', true],
  ])(
    'maps rm code %s to %s with mayBePartial=%s',
    async (code, errorCode, mayBePartial) => {
      const f = fixture();
      f.rm.mockRejectedValue(
        Object.assign(new Error('private path and message'), {
          code,
          path: target,
        }),
      );
      await expect(
        deleteTarget(
          { path: target, kind: 'node_modules', apparentBytes: 10 },
          f.deps,
        ),
      ).resolves.toEqual({
        method: 'permanent',
        status: 'failed',
        errorCode,
        mayBePartial,
      });
      expect(f.rm).toHaveBeenCalledTimes(1);
      expect(f.rm.mock.calls[0][1]).toBe(PERMANENT_RM_OPTIONS);
      expect(f.recycle).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Error without code', new Error('private stack and message')],
    ['string', 'private error path'],
    ['null', null],
    ['undefined', undefined],
  ])(
    'contains an rm rejection with %s without exposing error details',
    async (_label, error) => {
      const f = fixture();
      f.rm.mockRejectedValue(error);
      const outcome = await deleteTarget(
        { path: target, kind: 'build_cache', apparentBytes: 1 },
        f.deps,
      );
      expect(outcome).toEqual({
        method: 'permanent',
        status: 'failed',
        errorCode: 'DELETE_FAILED',
        mayBePartial: true,
      });
      expect(outcome).not.toHaveProperty('message');
      expect(outcome).not.toHaveProperty('stack');
      expect(outcome).not.toHaveProperty('path');
      expect(f.rm).toHaveBeenCalledTimes(1);
      expect(f.recycle).not.toHaveBeenCalled();
    },
  );

  it('contains a synchronous rm throw without retrying', async () => {
    const f = fixture();
    f.rm.mockImplementation(() => {
      throw Object.assign(new Error('private'), { code: 'EBUSY' });
    });
    await expect(
      deleteTarget(
        { path: target, kind: 'node_modules', apparentBytes: 0 },
        f.deps,
      ),
    ).resolves.toEqual({
      method: 'permanent',
      status: 'failed',
      errorCode: 'FILE_IN_USE',
      mayBePartial: true,
    });
    expect(f.rm).toHaveBeenCalledTimes(1);
    expect(f.recycle).not.toHaveBeenCalled();
  });

  it.each([
    'RECYCLE_BIN_DISABLED',
    'RECYCLE_BIN_TOO_SMALL',
    'RECYCLE_UNAVAILABLE',
    'RECYCLE_FAILED',
  ] as const)(
    'preserves %s without retry or permanent fallback',
    async (code) => {
      const f = fixture();
      f.recycle.mockResolvedValue({
        status: 'failed',
        code,
        message: 'private detail',
      });
      await expect(
        deleteTarget(
          { path: target, kind: 'project', apparentBytes: 50 },
          f.deps,
        ),
      ).resolves.toEqual({
        method: 'recycle',
        status: 'failed',
        errorCode: code,
        mayBePartial: false,
      });
      expect(f.recycle).toHaveBeenCalledTimes(1);
      expect(f.recycle).toHaveBeenCalledWith(target, 50);
      expect(f.rm).not.toHaveBeenCalled();
    },
  );

  it.each(['throw', 'reject'] as const)(
    'contains a recycle %s without permanent fallback',
    async (mode) => {
      const f = fixture();
      f.recycle.mockImplementation(() => {
        if (mode === 'throw') throw new Error('private recycle error');
        return Promise.reject(new Error('private recycle error'));
      });
      await expect(
        deleteTarget(
          { path: target, kind: 'project_content', apparentBytes: 1 },
          f.deps,
        ),
      ).resolves.toEqual({
        method: 'recycle',
        status: 'failed',
        errorCode: 'RECYCLE_FAILED',
        mayBePartial: false,
      });
      expect(f.recycle).toHaveBeenCalledTimes(1);
      expect(f.rm).not.toHaveBeenCalled();
    },
  );

  it.each([NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, -Infinity])(
    'rejects invalid recycle bytes %s without calling either dependency',
    async (apparentBytes) => {
      const f = fixture();
      await expect(
        deleteTarget({ path: target, kind: 'project', apparentBytes }, f.deps),
      ).resolves.toEqual({
        method: 'recycle',
        status: 'failed',
        errorCode: 'RECYCLE_FAILED',
        mayBePartial: false,
      });
      expect(f.recycle).not.toHaveBeenCalled();
      expect(f.rm).not.toHaveBeenCalled();
    },
  );

  it.each([0, Number.MAX_SAFE_INTEGER])(
    'accepts recycle byte boundary %s',
    async (apparentBytes) => {
      const f = fixture();
      await expect(
        deleteTarget({ path: target, kind: 'project', apparentBytes }, f.deps),
      ).resolves.toEqual({ method: 'recycle', status: 'success' });
      expect(f.recycle).toHaveBeenCalledTimes(1);
      expect(f.recycle).toHaveBeenCalledWith(target, apparentBytes);
      expect(f.rm).not.toHaveBeenCalled();
    },
  );

  it('does not use apparentBytes to gate a permanent deletion', async () => {
    const f = fixture();
    await expect(
      deleteTarget(
        { path: target, kind: 'node_modules', apparentBytes: NaN },
        f.deps,
      ),
    ).resolves.toEqual({ method: 'permanent', status: 'success' });
    expect(f.rm).toHaveBeenCalledTimes(1);
    expect(f.recycle).not.toHaveBeenCalled();
  });
});
