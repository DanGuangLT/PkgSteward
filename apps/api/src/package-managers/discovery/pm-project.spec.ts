import { win32 as path } from 'node:path';
import {
  readPmProject,
  commitPmPin,
  cleanupPmTemp,
} from '@/package-managers/discovery/pm-project';
import { planPinEdit } from '@/package-managers/pinning/pm-manifest';
import { pmIoFixture } from '@/package-managers/__fixtures__/pm-io.fixture';
import { key, root, tool } from '@/npm-runner/__fixtures__/runner-test.fixture';
import type { IRunnerTool } from '@/npm-runner/interfaces/npm-runner.types';
import {
  AppException,
  ForbiddenException,
} from '@/common/exceptions/app.exception';

const setup = () => {
  const f = pmIoFixture();
  const read = () => readPmProject(root, f.deps);
  const commit = async (boundary = () => Promise.resolve()) => {
    const facts = await read();
    return commitPmPin(
      facts,
      planPinEdit(facts.bytes, 'npm@11.17.0'),
      f.controller.signal,
      { ...f.deps, beforeRename: boundary },
    );
  };
  return { ...f, read, commit };
};

describe('M9 guarded static project input', () => {
  it('settles both parallel static tool reads before propagating cancellation', async () => {
    const f = setup();
    let started!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finish: Array<(value: IRunnerTool) => void> = [];
    f.resolveTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
          if (finish.length === 2) started();
        }),
    );
    let stopped = false;
    const pending = f.read().catch(() => {
      stopped = true;
    });
    await bothStarted;
    f.controller.abort();
    finish[0](tool('npm'));
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish[1](tool('pnpm'));
    await pending;
    expect(stopped).toBe(true);
  });
  it('reads fresh pin and both static tools; keeps Yarn explicitly unsupported', async () => {
    const f = setup();
    const facts = await f.read();
    expect(facts.context.rawPin).toBe('npm@11.16.0');
    expect(facts.context.installed.map((item) => item.status)).toEqual([
      'available',
      'available',
      'unsupported',
    ]);
    expect(facts.context.projectName).toBe('TEST-pin');
    expect(f.openExclusive).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });
  it('refuses absent scan, descendant membership and the shared guard', async () => {
    const f = setup();
    await expect(
      readPmProject(root, { ...f.deps, getScanSnapshot: () => null }),
    ).rejects.toThrow();
    await expect(
      readPmProject(path.join(root, 'child'), f.deps),
    ).rejects.toMatchObject({ details: { reason: 'PROJECT_NOT_SCANNED' } });
    f.assertAllowed.mockRejectedValueOnce(new ForbiddenException());
    await expect(f.read()).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([17, { unknown: true }, null])(
    'displays nonstring pin %p as inert without rewriting it',
    async (pin) => {
      const f = setup();
      f.put(
        f.manifest,
        JSON.stringify({ name: 'TEST-pin', packageManager: pin }),
      );
      const facts = await f.read();
      expect(facts.context.pinState).toBe('unsupported');
      expect(facts.context.reason).toBe('PIN_UNSUPPORTED');
    },
  );
  it('keeps corporate registry routing readable without importing M7 policy', async () => {
    const f = setup();
    f.put(
      path.join(root, '.npmrc'),
      'registry=https://TEST.invalid\n//TEST.invalid/:_authToken=TEST',
    );
    expect((await f.read()).context.reason).toBeNull();
  });
  it('reports workspace roots, leaves and unmanaged devEngines from fresh inputs', async () => {
    const f = setup();
    f.put(f.manifest, '{"name":"TEST-root","workspaces":["packages/*"]}');
    expect((await f.read()).context.workspace.kind).toBe('root');
    f.put(f.manifest, '{"name":"TEST-leaf"}');
    f.put('D:\\TEST\\package.json', '{"workspaces":["project"]}');
    expect((await f.read()).context.reason).toBe('WORKSPACE_LEAF');
    f.remove('D:\\TEST\\package.json');
    f.put(f.manifest, '{"devEngines":{"packageManager":{"name":"npm"}}}');
    const facts = await f.read();
    expect(facts.context.devEnginesPresent).toBe(true);
    expect(facts.context.reason).toBe('CONFIG_UNSUPPORTED');
    expect(facts.context.warnings).toContain('DEV_ENGINES_NOT_MANAGED');
  });
  it('keeps the installed Yarn declaration readable and refuses conflicting lock families', async () => {
    const f = setup();
    f.put(f.manifest, '{"packageManager":"yarn@1.22.22"}');
    expect((await f.read()).context.parsedPin?.manager).toBe('yarn');
    f.put(path.join(root, 'package-lock.json'), '{}');
    f.put(path.join(root, 'pnpm-lock.yaml'), 'TEST');
    expect((await f.read()).context.reason).toBe('LOCKFILE_MISMATCH');
  });
  it('checks handle nlink and rejects non-UTF8 input', async () => {
    const f = setup();
    const open = f.open.getMockImplementation()!;
    f.open.mockImplementationOnce(async (file) => {
      const handle = await open(file);
      return {
        ...handle,
        stat: async () => ({ ...(await handle.stat()), nlink: 2 }),
      };
    });
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'CONFIG_UNSUPPORTED' },
    });
    f.put(f.manifest, 'x');
    f.files.set(key(f.manifest), Buffer.from([255]));
    await expect(f.read()).rejects.toThrow();
  });
  it('keeps old-pin major mismatch repairable with a supported installed tool', async () => {
    const f = setup();
    f.put(f.manifest, '{"packageManager":"npm@10.0.0"}');
    expect((await f.read()).context.reason).toBe('TOOL_VERSION_MISMATCH');
  });
  it('returns partial tool availability rather than failing all context', async () => {
    const f = setup();
    f.resolveTool.mockImplementation((manager) =>
      manager === 'pnpm'
        ? Promise.reject(
            new AppException(409, 'TEST', 'CONFLICT', {
              reason: 'TOOL_NOT_FOUND',
            }),
          )
        : Promise.resolve({
            manager,
            version: '11.17.0',
            file: 'C:\\node.exe',
            entry: null,
            packageDir: 'C:\\npm',
            identities: [],
          }),
    );
    const facts = await f.read();
    expect(facts.context.installed[0].status).toBe('available');
    expect(facts.context.installed[1].reason).toBe('TOOL_NOT_FOUND');
  });
  it.each(['root', 'manifest'] as const)(
    'refuses visible %s link/redirect and a mismatched read handle',
    async (which) => {
      const f = setup();
      const file = which === 'root' ? root : f.manifest;
      f.realpaths.set(key(file), 'D:\\TEST\\elsewhere');
      await expect(f.read()).rejects.toThrow();
      f.realpaths.clear();
      f.openedStats.set(key(f.manifest), {
        ...f.stats.get(key(f.manifest))!,
        ino: 999,
      });
      await expect(f.read()).rejects.toThrow();
    },
  );
  it('refuses hardlinked manifests before any temp creation', async () => {
    const f = setup();
    const original = f.lstat.getMockImplementation()!;
    f.lstat.mockImplementation(async (file) => ({
      ...(await original(file)),
      nlink: key(file) === key(f.manifest) ? 2 : 1,
    }));
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'CONFIG_UNSUPPORTED' },
    });
    expect(f.openExclusive).not.toHaveBeenCalled();
  });
  it('detects a latest-scan change during IO', async () => {
    const f = setup();
    let calls = 0;
    await expect(
      readPmProject(root, {
        ...f.deps,
        getScanSnapshot: () =>
          ++calls > 1 ? { ...f.scan, scanId: 'TEST-changed' } : f.scan,
      }),
    ).rejects.toMatchObject({ details: { reason: 'SCAN_CHANGED' } });
  });
});

describe('M9 atomic manifest pin commit', () => {
  it('reports failed postcondition without rolling back an already committed rename', async () => {
    const f = setup();
    const rename = f.rename.getMockImplementation()!;
    f.rename.mockImplementation(async (from, to) => {
      await rename(from, to);
      f.put(to, '{"name":"TEST-concurrent-editor"}');
    });
    const result = await f.commit();
    expect(result.fileCommitted).toBe(true);
    expect(result.mayHaveChanged).toBe(true);
    expect(result.failureCode).toBe('POSTCONDITION_FAILED');
    expect(f.files.get(key(f.manifest))?.toString()).toBe(
      '{"name":"TEST-concurrent-editor"}',
    );
    expect(f.rename).toHaveBeenCalledTimes(1);
  });
  it.each([
    '\uFEFF{\r\n  "name": "TEST-bom",\r\n  "packageManager": "npm@11.16.0"\r\n}\r\n',
    '{"name":"TEST-compact"}',
    '{"packageManager":"npm@11.16.0+sha224.' + 'a'.repeat(56) + '"}',
  ])(
    'commits only the planned bytes for BOM/compact/hashed inputs',
    async (source) => {
      const f = setup();
      f.put(f.manifest, source);
      const expected = planPinEdit(Buffer.from(source), 'npm@11.17.0');
      const result = await f.commit();
      expect(result.failureCode).toBeNull();
      expect(f.files.get(key(f.manifest))).toEqual(expected.bytes);
    },
  );
  it.each(['config', 'lock', 'scan', 'root', 'hardlink'] as const)(
    'refuses a late %s change before rename',
    async (change) => {
      const f = setup();
      const originalStat = f.lstat.getMockImplementation()!;
      const result = await f.commit(() => {
        if (change === 'config')
          f.put(path.join(root, '.npmrc'), 'prefix=D:\\TEST\\other');
        if (change === 'lock') f.put(path.join(root, 'pnpm-lock.yaml'), 'TEST');
        if (change === 'scan') f.scan.scanId = 'TEST-new-scan';
        if (change === 'root')
          f.stats.set(key(root), { ...f.stats.get(key(root))!, ino: 555 });
        if (change === 'hardlink')
          f.lstat.mockImplementation(async (file) => ({
            ...(await originalStat(file)),
            nlink: key(file) === key(f.manifest) ? 2 : 1,
          }));
        return Promise.resolve();
      });
      expect(result.failureCode).toBe(
        change === 'scan' ? 'SCAN_CHANGED' : 'PREVIEW_CHANGED',
      );
      expect(result.mayHaveChanged).toBe(false);
      expect(f.rename).not.toHaveBeenCalled();
    },
  );
  it('checks the caller TTL boundary again after final filesystem awaits', async () => {
    const f = setup();
    let checks = 0;
    const result = await f.commit(() => {
      if (++checks === 2)
        throw new AppException(409, 'TEST expired', 'CONFLICT', {
          reason: 'PREVIEW_EXPIRED',
        });
      return Promise.resolve();
    });
    expect(result.failureCode).toBe('PREVIEW_EXPIRED');
    expect(result.mayHaveChanged).toBe(false);
    expect(f.rename).not.toHaveBeenCalled();
  });
  it('keeps a pending write unsettled after abort, then closes and cleans it without renaming', async () => {
    const f = setup();
    const open = f.openExclusive.getMockImplementation()!;
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    let settle!: () => void;
    f.openExclusive.mockImplementation(async (file, flags) => {
      const handle = await open(file, flags);
      return {
        ...handle,
        write: () => {
          started();
          return new Promise<void>((resolve) => {
            settle = resolve;
          });
        },
      };
    });
    let finished = false;
    const pending = f.commit().then((result) => {
      finished = true;
      return result;
    });
    await writing;
    f.controller.abort();
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(f.unlink).not.toHaveBeenCalled();
    settle();
    const result = await pending;
    expect(result.failureCode).toBe('CANCELLED');
    expect(result.cleanupRequired).toBe(false);
    expect(f.rename).not.toHaveBeenCalled();
  });
  it.each(['write', 'sync', 'close'] as const)(
    'handles %s failure without an original-file unlink fallback',
    async (stage) => {
      const f = setup();
      const open = f.openExclusive.getMockImplementation()!;
      let failed = false;
      f.openExclusive.mockImplementation(async (file, flags) => {
        const handle = await open(file, flags);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- re-invoked below with call(handle)
        const original = handle[stage] as () => Promise<void>;
        if (stage === 'write')
          return {
            ...handle,
            write: () => Promise.reject(new Error('TEST write')),
          };
        return {
          ...handle,
          [stage]: () => {
            if (!failed) {
              failed = true;
              return Promise.reject(new Error('TEST IO'));
            }
            return original.call(handle) as Promise<void>;
          },
        };
      });
      const result = await f.commit();
      expect(result.failureCode).toBe('MANIFEST_WRITE_FAILED');
      expect(result.mayHaveChanged).toBe(false);
      expect(f.rename).not.toHaveBeenCalled();
      expect(
        f.unlink.mock.calls.every(([file]) => key(file) !== key(f.manifest)),
      ).toBe(true);
    },
  );
  it('creates a sibling wx temp, writes/syncs/closes then renames and verifies exact bytes', async () => {
    const f = setup();
    const before = f.files.get(key(f.manifest))!;
    const result = await f.commit();
    expect(result.failureCode).toBeNull();
    expect(result.fileCommitted).toBe(true);
    expect(result.mayHaveChanged).toBe(true);
    expect(result.observedPin).toBe('npm@11.17.0');
    expect(f.files.get(key(f.manifest))).toEqual(
      planPinEdit(before, 'npm@11.17.0').bytes,
    );
    expect(f.events.slice(0, 5)).toEqual([
      'open:wx',
      'write',
      'sync',
      'close',
      'rename',
    ]);
    expect(f.openExclusive.mock.calls[0][0]).toMatch(
      /package\.json\.[a-f0-9-]+\.pkgsteward-tmp$/,
    );
    expect(
      f.unlink.mock.calls.every(([file]) => key(file) !== key(f.manifest)),
    ).toBe(true);
  });
  it('rechecks the manifest identity immediately before rename', async () => {
    const f = setup();
    const result = await f.commit(() => {
      f.put(f.manifest, '{"name":"TEST-editor"}');
      return Promise.resolve();
    });
    expect(result.failureCode).toBe('PREVIEW_CHANGED');
    expect(result.mayHaveChanged).toBe(false);
    expect(f.rename).not.toHaveBeenCalled();
    expect(result.cleanupRequired).toBe(false);
  });
  it('stops before rename and cleans the owned temp on cancellation', async () => {
    const f = setup();
    const result = await f.commit(() => {
      f.controller.abort();
      return Promise.resolve();
    });
    expect(result.failureCode).toBe('CANCELLED');
    expect(result.cleanupRequired).toBe(false);
    expect(result.fileCommitted).toBe(false);
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.unlink).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['EBUSY', 'FILE_IN_USE'],
    ['EPERM', 'FILE_IN_USE'],
    ['EACCES', 'ACCESS_DENIED'],
    ['EIO', 'MANIFEST_WRITE_FAILED'],
  ])(
    'reports a %s rename failure as %s and unchanged when the original is proven intact',
    async (code, reason) => {
      const f = setup();
      const before = f.files.get(key(f.manifest))?.toString();
      f.rename.mockImplementation(() =>
        Promise.reject(Object.assign(new Error('TEST rename'), { code })),
      );
      const result = await f.commit();
      expect(result.fileCommitted).toBe(false);
      expect(result.mayHaveChanged).toBe(false);
      expect(result.failureCode).toBe(reason);
      expect(f.files.get(key(f.manifest))?.toString()).toBe(before);
      expect(result.temp).toBeNull();
    },
  );
  it('keeps mayHaveChanged when a failed rename leaves a different file in place', async () => {
    const f = setup();
    f.rename.mockImplementation((_from, to) => {
      f.put(to, '{"name":"TEST-other-writer"}');
      return Promise.reject(
        Object.assign(new Error('TEST rename'), { code: 'EBUSY' }),
      );
    });
    const result = await f.commit();
    expect(result.fileCommitted).toBe(false);
    expect(result.mayHaveChanged).toBe(true);
    expect(result.failureCode).toBe('FILE_IN_USE');
  });
  it('settles postcommit verification after cancellation', async () => {
    const f = setup();
    const rename = f.rename.getMockImplementation()!;
    f.rename.mockImplementation(async (from, to) => {
      await rename(from, to);
      f.controller.abort();
    });
    const result = await f.commit();
    expect(result.fileCommitted).toBe(true);
    expect(result.failureCode).toBeNull();
    expect(result.observedPin).toBe('npm@11.17.0');
  });
  it('marks an ambiguous rename as mayHaveChanged and observes the actual committed file', async () => {
    const f = setup();
    const rename = f.rename.getMockImplementation()!;
    f.rename.mockImplementation(async (from, to) => {
      await rename(from, to);
      throw new Error('TEST ambiguous');
    });
    const result = await f.commit();
    expect(result.failureCode).toBe('MANIFEST_WRITE_FAILED');
    expect(result.mayHaveChanged).toBe(true);
    expect(result.fileCommitted).toBe(true);
    expect(result.observedPin).toBe('npm@11.17.0');
  });
  it('does not unlink the original on a locked-file rename error', async () => {
    const f = setup();
    f.rename.mockRejectedValueOnce(
      Object.assign(new Error('TEST locked'), { code: 'EPERM' }),
    );
    const result = await f.commit();
    expect(result.failureCode).toBe('FILE_IN_USE');
    expect(result.fileCommitted).toBe(false);
    expect(result.mayHaveChanged).toBe(false);
    expect(f.files.get(key(f.manifest))?.toString()).toContain('11.16.0');
    expect(f.unlink.mock.calls.every(([file]) => file !== f.manifest)).toBe(
      true,
    );
  });
  it('never deletes a colliding wx temp', async () => {
    const f = setup();
    f.put(`${f.manifest}.${f.deps.uuid()}.pkgsteward-tmp`, 'TEST someone else');
    const result = await f.commit();
    expect(result.failureCode).toBe('MANIFEST_WRITE_FAILED');
    expect(f.unlink).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });
  it('retains cleanup-only state when owned temp unlink fails, and retries without another rename', async () => {
    const f = setup();
    f.unlink.mockRejectedValueOnce(new Error('TEST cleanup'));
    const result = await f.commit(() => {
      f.controller.abort();
      return Promise.resolve();
    });
    expect(result.cleanupRequired).toBe(true);
    expect(result.temp).not.toBeNull();
    await cleanupPmTemp(result.temp!, f.deps);
    expect(f.rename).not.toHaveBeenCalled();
  });
  it('refuses cleanup of a replaced or linked temp', async () => {
    const f = setup();
    f.unlink.mockRejectedValueOnce(new Error('TEST cleanup'));
    const result = await f.commit(() => {
      f.controller.abort();
      return Promise.resolve();
    });
    f.stats.set(key(result.temp!.path), {
      ...f.stats.get(key(result.temp!.path))!,
      ino: 888,
    });
    await expect(cleanupPmTemp(result.temp!, f.deps)).rejects.toMatchObject({
      details: { reason: 'TEMP_CLEANUP_FAILED' },
    });
    expect(f.unlink).toHaveBeenCalledTimes(1);
  });
});
