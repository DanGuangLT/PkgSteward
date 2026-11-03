jest.mock('execa', () => ({ execa: jest.fn() }));

import { execa } from 'execa';
import type {
  IProcessInfo,
  ProcessSnapshotResult,
} from '@/platform/interfaces/process-snapshot.interface';
import { createWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';
import type {
  IRunnerProcessIdentity,
  IWindowsRunnerProcess,
} from '@/platform/windows/windows-runner-process';

const execaMock = execa as unknown as jest.Mock<
  Promise<{ exitCode: number }>,
  [string, readonly string[], object]
>;
const root: IRunnerProcessIdentity = {
  pid: 10,
  creationTime: '2026-11-03T02:00:00.000Z',
};
const child: IRunnerProcessIdentity = {
  pid: 11,
  creationTime: '2026-11-03T02:00:01.000Z',
};
const grandchild: IRunnerProcessIdentity = {
  pid: 12,
  creationTime: '2026-11-03T02:00:02.000Z',
};
const info = (
  identity: IRunnerProcessIdentity,
  parentPid: number,
): IProcessInfo => ({
  ...identity,
  parentPid,
  name: 'node.exe',
  executablePath: null,
  commandLine: null,
});
const ok = (...processes: IProcessInfo[]): ProcessSnapshotResult => ({
  status: 'ok',
  processes,
});

describe('createWindowsRunnerProcess', () => {
  let adapter: IWindowsRunnerProcess;
  let time: number;
  let snapshot: jest.Mock<Promise<ProcessSnapshotResult>, []>;
  let sleep: jest.Mock<Promise<void>, [number]>;

  beforeEach(() => {
    time = 0;
    snapshot = jest.fn<Promise<ProcessSnapshotResult>, []>();
    snapshot.mockResolvedValue(ok(info(root, 1)));
    sleep = jest.fn<Promise<void>, [number]>().mockImplementation((ms) => {
      time += ms;
      return Promise.resolve();
    });
    execaMock.mockReset().mockResolvedValue({ exitCode: 0 });
    adapter = createWindowsRunnerProcess({
      snapshot: { capture: snapshot },
      systemRoot: 'C:\\Windows',
      now: () => time,
      sleep,
    });
  });

  it('captures pid plus creation time immediately, without starting polling', async () => {
    const intervalSpy = jest.spyOn(global, 'setInterval');
    try {
      await expect(adapter.capture(root.pid)).resolves.toEqual({
        status: 'ok',
        identity: root,
      });
      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(intervalSpy).not.toHaveBeenCalled();
      expect(execaMock).not.toHaveBeenCalled();
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses invalid root pid %j without consulting helpers',
    async (pid) => {
      await expect(adapter.capture(pid)).resolves.toEqual({
        status: 'unknown',
      });
      expect(snapshot).not.toHaveBeenCalled();
      expect(execaMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ok(),
    ok({ ...info(root, 1), creationTime: null }),
    ok({ pid: root.pid, name: '', executablePath: null, commandLine: null }),
    ok({ ...info(root, 1), creationTime: 'invalid' }),
    ok(info(root, 1), { ...info(root, 1), creationTime: child.creationTime }),
    { status: 'unknown', reason: 'timeout' },
  ])(
    'returns unknown for missing, ambiguous or unidentifiable root (%j)',
    async (result) => {
      snapshot.mockResolvedValue(result);
      await expect(adapter.capture(root.pid)).resolves.toEqual({
        status: 'unknown',
      });
      expect(execaMock).not.toHaveBeenCalled();
    },
  );

  it('maps a throwing snapshot dependency to unknown without leaking its message', async () => {
    snapshot.mockRejectedValue(new Error('PRIVATE_COMMAND_LINE'));
    await expect(adapter.capture(root.pid)).resolves.toEqual({
      status: 'unknown',
    });
  });

  it('finds the complete unordered parent chain, excluding unrelated/older processes', async () => {
    snapshot.mockResolvedValue(
      ok(
        info(grandchild, child.pid),
        info({ pid: 99, creationTime: child.creationTime }, 90),
        info({ pid: 98, creationTime: '2026-11-03T01:00:00.000Z' }, root.pid),
        info(child, root.pid),
        info(root, 1),
      ),
    );
    const result = await adapter.descendants(root);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.identities).toHaveLength(2);
      expect(result.identities).toEqual(
        expect.arrayContaining([child, grandchild]),
      );
    }
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('accepts equal creation times and compares dates by time rather than lexical order', async () => {
    const equal = { pid: 13, creationTime: root.creationTime };
    const offset = { pid: 14, creationTime: '2026-11-02T23:00:01.000-03:00' };
    snapshot.mockResolvedValue(
      ok(info(root, 1), info(equal, root.pid), info(offset, equal.pid)),
    );
    const result = await adapter.descendants(root);
    expect(result.status).toBe('ok');
    if (result.status === 'ok')
      expect(result.identities).toEqual(
        expect.arrayContaining([equal, offset]),
      );
  });

  it('discovers direct orphans after root exit and children naming a dead tracked parent', async () => {
    snapshot.mockResolvedValue(ok(info(child, root.pid), info(grandchild, 21)));
    const deadParent = { pid: 21, creationTime: child.creationTime };
    const result = await adapter.descendants(root, [deadParent]);
    expect(result.status).toBe('ok');
    if (result.status === 'ok')
      expect(result.identities).toEqual(
        expect.arrayContaining([child, grandchild]),
      );
  });

  it('fails closed on a descendant whose creation time cannot be established', async () => {
    snapshot.mockResolvedValue(
      ok(info(root, 1), { ...info(child, root.pid), creationTime: null }),
    );
    await expect(adapter.descendants(root)).resolves.toEqual({
      status: 'unknown',
    });
  });

  it('does not attribute the tree of a reused root PID to the original root', async () => {
    snapshot.mockResolvedValue(
      ok(
        { ...info(root, 1), creationTime: grandchild.creationTime },
        info({ pid: 13, creationTime: '2026-11-03T03:00:00.000Z' }, root.pid),
      ),
    );
    await expect(adapter.descendants(root)).resolves.toEqual({
      status: 'unknown',
    });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('returns unknown on snapshot failure while finding descendants', async () => {
    snapshot.mockResolvedValue({ status: 'unknown', reason: 'overflow' });
    await expect(adapter.descendants(root)).resolves.toEqual({
      status: 'unknown',
    });
  });

  it('uses the absolute taskkill path and exact argv only after matching identity', async () => {
    snapshot.mockResolvedValue(ok(info(root, 1), info(child, root.pid)));
    await expect(adapter.stopTree(root, [child])).resolves.toBe('attempted');
    expect(execaMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '10', '/T', '/F'],
      expect.objectContaining({
        timeout: 10_000,
        shell: false,
        preferLocal: false,
        windowsHide: true,
        stdin: 'ignore',
      }),
    );
    expect(snapshot.mock.invocationCallOrder[0]).toBeLessThan(
      execaMock.mock.invocationCallOrder[0],
    );
  });

  it('stops both a live root and a tracked orphan in the first attempt', async () => {
    snapshot
      .mockResolvedValueOnce(ok(info(root, 1), info(grandchild, child.pid)))
      .mockResolvedValue(ok(info(grandchild, child.pid)));
    await expect(adapter.stopTree(root, [grandchild])).resolves.toBe(
      'attempted',
    );
    expect(execaMock.mock.calls.map(([, args]) => args)).toEqual([
      ['/PID', '10', '/T', '/F'],
      ['/PID', '12', '/T', '/F'],
    ]);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(execaMock.mock.invocationCallOrder[0]).toBeLessThan(
      snapshot.mock.invocationCallOrder[1],
    );
    expect(snapshot.mock.invocationCallOrder[1]).toBeLessThan(
      execaMock.mock.invocationCallOrder[1],
    );
  });

  it('skips a tracked descendant already ended by the root taskkill', async () => {
    snapshot
      .mockResolvedValueOnce(ok(info(root, 1), info(child, root.pid)))
      .mockResolvedValue(ok());
    await expect(adapter.stopTree(root, [child])).resolves.toBe('attempted');
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0][1]).toEqual(['/PID', '10', '/T', '/F']);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('never launches taskkill when the fresh stop snapshot is unknown', async () => {
    snapshot.mockResolvedValue({ status: 'unknown', reason: 'timeout' });
    await expect(adapter.stopTree(root, [child])).resolves.toBe('unconfirmed');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('does not call taskkill on a reused root or reused tracked child', async () => {
    snapshot.mockResolvedValue(
      ok(
        { ...info(root, 1), creationTime: grandchild.creationTime },
        { ...info(child, root.pid), creationTime: grandchild.creationTime },
      ),
    );
    await adapter.stopTree(root, [child]);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('kills only still-matching tracked descendants when the root has already exited', async () => {
    snapshot.mockResolvedValue(
      ok(info(child, root.pid), {
        ...info(grandchild, child.pid),
        creationTime: '2026-11-03T04:00:00.000Z',
      }),
    );
    await adapter.stopTree(root, [child, grandchild]);
    expect(execaMock).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '11', '/T', '/F'],
      expect.any(Object),
    );
    for (const [, args] of execaMock.mock.calls) {
      expect(args[1]).toBe('11');
    }
  });

  it('rechecks identity between helpers instead of trusting the stop snapshot', async () => {
    snapshot
      .mockResolvedValueOnce(
        ok(info(child, root.pid), info(grandchild, root.pid)),
      )
      .mockResolvedValue(
        ok({
          ...info(grandchild, root.pid),
          creationTime: '2026-11-03T04:00:00.000Z',
        }),
      );
    await adapter.stopTree(root, [child, grandchild]);
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0][1]).toEqual(['/PID', '11', '/T', '/F']);
    expect(snapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    undefined,
    '',
    'Windows',
    'C:Windows',
    '\\Windows',
    '\\\\server\\share',
    '\\\\?\\C:\\Windows',
    'C:\\Windows\0',
  ])(
    'refuses unsafe SystemRoot %j before any PID helper',
    async (systemRoot) => {
      const unsafe = createWindowsRunnerProcess({
        snapshot: { capture: snapshot },
        systemRoot,
        now: () => time,
        sleep,
      });
      await expect(unsafe.stopTree(root, [child])).resolves.toBe('unconfirmed');
      expect(execaMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { timedOut: true },
    { code: 'ENOENT' },
    new Error('PRIVATE_HELPER_OUTPUT'),
  ])('handles helper failure %j as unconfirmed', async (failure) => {
    execaMock.mockRejectedValue(failure);
    await expect(adapter.stopTree(root, [])).resolves.toBe('unconfirmed');
  });

  it('does not treat a nonzero resolved helper result as success', async () => {
    execaMock.mockResolvedValue({ exitCode: 1 });
    await expect(adapter.stopTree(root, [])).resolves.toBe('unconfirmed');
  });

  it('requires two empty observations at least 250ms apart', async () => {
    snapshot.mockResolvedValue(ok());
    await expect(adapter.verifyGone([root, child])).resolves.toBe('verified');
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(time).toBe(250);
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('resets consecutive-empty evidence when a tracked survivor appears', async () => {
    snapshot
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok(info(child, root.pid)))
      .mockResolvedValue(ok());
    await expect(adapter.verifyGone([root, child])).resolves.toBe('verified');
    expect(snapshot).toHaveBeenCalledTimes(4);
    expect(time).toBeGreaterThanOrEqual(750);
  });

  it('taskkill exit zero is insufficient when the original identity survives', async () => {
    await expect(adapter.stopTree(root, [])).resolves.toBe('attempted');
    await expect(adapter.verifyGone([root])).resolves.toBe('unconfirmed');
    expect(time).toBeGreaterThanOrEqual(10_000);
    expect(time).toBeLessThanOrEqual(10_250);
    expect(snapshot.mock.calls.length).toBeLessThanOrEqual(43);
  });

  it('cannot verify while a tracked descendant survives after root exit', async () => {
    snapshot.mockResolvedValue(ok(info(child, root.pid)));
    await expect(adapter.verifyGone([root, child])).resolves.toBe(
      'unconfirmed',
    );
    expect(time).toBeLessThanOrEqual(10_250);
  });

  it('treats a PID with a different valid creation time as the original identity gone', async () => {
    snapshot.mockResolvedValue(
      ok({ ...info(root, 1), creationTime: child.creationTime }),
    );
    await expect(adapter.verifyGone([root])).resolves.toBe('verified');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'unknown', reason: 'timeout' },
    ok({ ...info(root, 1), creationTime: null }),
    ok(info(root, 1), { ...info(root, 1), creationTime: child.creationTime }),
  ])(
    'does not verify absence from an unknown/ambiguous observation (%j)',
    async (result) => {
      snapshot.mockResolvedValue(result);
      await expect(adapter.verifyGone([root])).resolves.toBe('unconfirmed');
      expect(time).toBeLessThanOrEqual(10_250);
    },
  );

  it('does not turn an empty tracked set into proof for an unknown root', async () => {
    await expect(adapter.verifyGone([])).resolves.toBe('unconfirmed');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('counts time spent awaiting a snapshot against the 10s verification budget', async () => {
    snapshot.mockImplementation(() => {
      time += 10_000;
      return Promise.resolve(ok());
    });
    await expect(adapter.verifyGone([root])).resolves.toBe('unconfirmed');
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns unconfirmed rather than rejecting on verification snapshot failure', async () => {
    snapshot.mockRejectedValue(new Error('PRIVATE_COMMAND_LINE'));
    await expect(adapter.verifyGone([root])).resolves.toBe('unconfirmed');
    expect(execaMock).not.toHaveBeenCalled();
  });
});
