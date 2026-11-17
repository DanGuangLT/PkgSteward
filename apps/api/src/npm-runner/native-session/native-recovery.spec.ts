import { win32 } from 'node:path';
import type { INativeSessionSnapshot } from '@/npm-runner/native-session/native-session';
import type { IWindowsNativeConsole } from '@/platform/windows/windows-native-console';
import {
  createNativeRecoveryStore,
  type IRecoveryFs,
  type IRecoveryFileStat,
} from '@/npm-runner/native-session/native-recovery';

// TEST only; không phải yêu cầu nghiệp vụ.
const dataDir = 'D:\\TEST\\data';
const journalPath = win32.join(dataDir, 'native-project-terminal-session.json');
const tempPath = win32.join(
  dataDir,
  'native-project-terminal-session.json.tmp',
);
const jobId = '11111111-1111-4111-8111-111111111111';
const makeSnapshot = (
  overrides: Partial<INativeSessionSnapshot> = {},
): INativeSessionSnapshot => ({
  schema: 1,
  jobId,
  generation: 1,
  fingerprint: 'fp-1',
  phase: 'launching',
  entries: {
    execPath: 'C:\\node\\node.exe',
    supervisorFile:
      'C:\\api\\dist\\npm-runner\\native-session\\native-console-supervisor.js',
    bridgeFile:
      'C:\\api\\dist\\npm-runner\\native-session\\native-console-entry.js',
    shellFile: 'C:\\Windows\\System32\\cmd.exe',
  },
  identities: {},
  tracked: [],
  initialRetired: false,
  initialOutcome: null,
  sessionOutcome: null,
  termination: null,
  ...overrides,
});

function fakeFs() {
  const files = new Map<
    string,
    { content: string; symlink?: boolean; dir?: boolean }
  >();
  const key = (target: string) => win32.normalize(target).toLowerCase();
  const makeStat = (entry: {
    content: string;
    symlink?: boolean;
    dir?: boolean;
  }): IRecoveryFileStat => ({
    isFile: () => !entry.dir && !entry.symlink,
    isDirectory: () => Boolean(entry.dir) && !entry.symlink,
    isSymbolicLink: () => Boolean(entry.symlink),
    size: Buffer.byteLength(entry.content, 'utf8'),
  });
  const enoent = (target: string) =>
    Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' });
  const eexist = (target: string) =>
    Object.assign(new Error(`EEXIST: ${target}`), { code: 'EEXIST' });
  const calls: string[] = [];
  const fs: IRecoveryFs = {
    mkdir: jest.fn((target: string) => {
      calls.push(`mkdir:${target}`);
      if (!files.has(key(target))) {
        files.set(key(target), { content: '', dir: true });
      }
      return Promise.resolve();
    }),
    lstat: jest.fn((target: string) => {
      const entry = files.get(key(target));
      if (!entry) return Promise.reject(enoent(target));
      return Promise.resolve(makeStat(entry));
    }),
    realpath: jest.fn((target: string) => {
      const entry = files.get(key(target));
      if (!entry) return Promise.reject(enoent(target));
      return Promise.resolve(
        entry.symlink ? 'D:\\TEST\\escaped' : win32.resolve(target),
      );
    }),
    readFile: jest.fn((target: string) => {
      const entry = files.get(key(target));
      if (!entry || entry.dir) return Promise.reject(enoent(target));
      return Promise.resolve(entry.content);
    }),
    openExclusiveWrite: jest.fn((target: string) => {
      calls.push(`open:${target}`);
      if (files.has(key(target))) return Promise.reject(eexist(target));
      let buffered = '';
      let synced = false;
      let closed = false;
      files.set(key(target), { content: '' });
      return Promise.resolve({
        writeAll: jest.fn((data: string) => {
          buffered += data;
          files.set(key(target), { content: buffered });
          return Promise.resolve();
        }),
        sync: jest.fn(() => {
          synced = true;
          calls.push(`sync:${target}:${synced}`);
          return Promise.resolve();
        }),
        close: jest.fn(() => {
          closed = true;
          calls.push(`close:${target}:${closed}`);
          return Promise.resolve();
        }),
      });
    }),
    rename: jest.fn((from: string, to: string) => {
      calls.push(`rename:${from}->${to}`);
      const entry = files.get(key(from));
      if (!entry) return Promise.reject(enoent(from));
      files.set(key(to), entry);
      files.delete(key(from));
      return Promise.resolve();
    }),
    unlink: jest.fn((target: string) => {
      calls.push(`unlink:${target}`);
      if (!files.has(key(target))) return Promise.reject(enoent(target));
      files.delete(key(target));
      return Promise.resolve();
    }),
  };
  return { fs, files, key, calls };
}

function fakePlatform() {
  return {
    descendants: jest.fn().mockResolvedValue({ status: 'ok', identities: [] }),
    verifyGone: jest.fn().mockResolvedValue('verified'),
  } as unknown as Pick<IWindowsNativeConsole, 'descendants' | 'verifyGone'>;
}

describe('createNativeRecoveryStore', () => {
  it('writes snapshots via mkdir + realpath check + exclusive temp + sync + atomic rename without unlinking main first', async () => {
    const f = fakeFs();
    const store = createNativeRecoveryStore({
      dataDir,
      platform: 'win32',
      fs: f.fs,
      console: fakePlatform(),
    });
    expect(store.journalPath).toBe(journalPath);
    await store.persist(makeSnapshot({ phase: 'launching' }));
    expect(f.calls).toEqual([
      `mkdir:${dataDir}`,
      `open:${tempPath}`,
      `sync:${tempPath}:true`,
      `close:${tempPath}:true`,
      `rename:${tempPath}->${journalPath}`,
    ]);
    expect(f.files.has(f.key(tempPath))).toBe(false);
    const saved = JSON.parse(
      f.files.get(f.key(journalPath))!.content,
    ) as unknown;
    expect(saved).toMatchObject({ schema: 1, jobId, phase: 'launching' });
  });

  it('rejects symlinked dataDir or symlinked journal markers fail-closed', async () => {
    const f = fakeFs();
    f.files.set(f.key(dataDir), { content: '', dir: true, symlink: true });
    const store = createNativeRecoveryStore({
      dataDir,
      platform: 'win32',
      fs: f.fs,
      console: fakePlatform(),
    });
    await expect(store.persist(makeSnapshot())).rejects.toThrow();

    f.files.set(f.key(dataDir), { content: '', dir: true });
    f.files.set(f.key(journalPath), { content: '{}', symlink: true });
    const evalSymlink = await store.evaluateOnStartup();
    expect(evalSymlink).toMatchObject({
      active: true,
      reason: 'UNSAFE_JOURNAL',
      journalPath,
    });
  });

  it('reports no hold when clean and activates hold on leftover temp, corrupt json, pre-ID launching or unresolved crash markers', async () => {
    const f = fakeFs();
    const store = createNativeRecoveryStore({
      dataDir,
      platform: 'win32',
      fs: f.fs,
      console: fakePlatform(),
    });
    expect(await store.evaluateOnStartup()).toEqual({
      active: false,
      hold: null,
      snapshot: null,
    });

    // Leftover .tmp file -> active hold
    f.files.set(f.key(tempPath), { content: '{"partial":' });
    const tempHold = await store.evaluateOnStartup();
    expect(tempHold).toMatchObject({
      active: true,
      reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
      journalPath,
    });
    f.files.delete(f.key(tempPath));

    // Corrupt main file -> active hold
    f.files.set(f.key(journalPath), { content: 'not-json' });
    expect(await store.evaluateOnStartup()).toMatchObject({
      active: true,
      reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
    });

    // Oversized main file -> active hold
    f.files.set(f.key(journalPath), { content: 'x'.repeat(300 * 1024) });
    expect(await store.evaluateOnStartup()).toMatchObject({
      active: true,
      reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
    });

    // Valid pre-ID launching marker -> active hold
    f.files.set(f.key(journalPath), {
      content: JSON.stringify(makeSnapshot({ phase: 'launching' })),
    });
    const preId = await store.evaluateOnStartup();
    expect(preId).toMatchObject({
      active: true,
      reason: 'UNRESOLVED_NATIVE_SESSION',
      snapshot: { phase: 'launching', jobId },
    });
  });

  it('verifies known non-retired processes are gone before clear and blocks without killing when alive or unknown', async () => {
    const f = fakeFs();
    const plat = fakePlatform();
    const store = createNativeRecoveryStore({
      dataDir,
      platform: 'win32',
      fs: f.fs,
      console: plat,
    });
    const supervisor = {
      pid: 10,
      creationTime: 't1',
      executablePath: 'C:\\node\\node.exe',
      parentPid: 1,
    };
    const retiredInitial = {
      pid: 30,
      creationTime: 't2',
      executablePath: 'C:\\node\\node.exe',
      parentPid: 20,
    };
    const shell = {
      pid: 30,
      creationTime: 't3',
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
      parentPid: 20,
    };
    f.files.set(f.key(journalPath), {
      content: JSON.stringify(
        makeSnapshot({
          phase: 'shell_running',
          identities: { supervisor, initial: retiredInitial, shell },
          initialRetired: true,
        }),
      ),
    });

    // Ambiguous descendants => block clear without killing
    jest.mocked(plat.descendants).mockResolvedValueOnce({ status: 'unknown' });
    await expect(store.verifyClearable()).resolves.toMatchObject({
      clearable: false,
      reason: 'PROCESSES_STILL_ACTIVE',
    });

    // Live descendant => block clear
    jest.mocked(plat.descendants).mockResolvedValueOnce({
      status: 'ok',
      identities: [shell],
    });
    await expect(store.verifyClearable()).resolves.toMatchObject({
      clearable: false,
      reason: 'PROCESSES_STILL_ACTIVE',
    });

    // Verified gone (retired initial must NEVER be passed to descendants/verifyGone)
    jest
      .mocked(plat.descendants)
      .mockResolvedValueOnce({ status: 'ok', identities: [] });
    jest.mocked(plat.verifyGone).mockResolvedValueOnce('verified');
    await expect(store.verifyClearable()).resolves.toMatchObject({
      clearable: true,
    });
    expect(plat.descendants).toHaveBeenLastCalledWith([supervisor, shell], []);
    expect(plat.verifyGone).toHaveBeenLastCalledWith([supervisor, shell]);
  });

  it('serializes persist and removeMarkers so late persist cannot resurrect removed journal', async () => {
    const f = fakeFs();
    const store = createNativeRecoveryStore({
      dataDir,
      platform: 'win32',
      fs: f.fs,
      console: fakePlatform(),
    });
    const first = makeSnapshot({ phase: 'shell_running' });
    await store.persist(first);
    await store.removeMarkers({ jobId, generation: 1 });
    expect(f.files.has(f.key(journalPath))).toBe(false);
    // Late persist for the sealed run identity must be ignored.
    await store.persist({ ...first, phase: 'closed' });
    expect(f.files.has(f.key(journalPath))).toBe(false);
    await expect(store.evaluateOnStartup()).resolves.toMatchObject({
      active: false,
    });
    // Next generation / new run must still persist normally.
    await store.persist(makeSnapshot({ generation: 2, phase: 'launching' }));
    expect(f.files.has(f.key(journalPath))).toBe(true);
  });

  it('retains main journal snapshot across leftover temp marker and verifies all crash barriers', async () => {
    const f = fakeFs();
    const plat = fakePlatform();
    const store = createNativeRecoveryStore({
      dataDir,
      platform: 'win32',
      fs: f.fs,
      console: plat,
    });
    const supervisor = {
      pid: 20,
      creationTime: 't1',
      executablePath: 'C:\\node\\node.exe',
      parentPid: 10,
    };
    const bridge = {
      pid: 25,
      creationTime: 't1b',
      executablePath: 'C:\\node\\node.exe',
      parentPid: 20,
    };
    const initial = {
      pid: 30,
      creationTime: 't2',
      executablePath: 'C:\\node\\node.exe',
      parentPid: 25,
    };
    const orphan = {
      pid: 40,
      creationTime: 't4',
      executablePath: 'C:\\tools\\node.exe',
      parentPid: 30,
    };

    // Temp leftover + intact main journal: MUST report CORRUPT_OR_PARTIAL_JOURNAL AND verify live PIDs.
    f.files.set(f.key(tempPath), { content: '{partial' });
    f.files.set(f.key(journalPath), {
      content: JSON.stringify(
        makeSnapshot({
          phase: 'bridge_ready',
          identities: { supervisor, bridge, initial },
        }),
      ),
    });
    jest.mocked(plat.descendants).mockResolvedValueOnce({
      status: 'ok',
      identities: [bridge],
    });
    await expect(store.evaluateOnStartup()).resolves.toMatchObject({
      active: true,
      reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
      snapshot: { phase: 'bridge_ready' },
    });
    await expect(store.verifyClearable()).resolves.toMatchObject({
      clearable: false,
      reason: 'PROCESSES_STILL_ACTIVE',
    });

    // Absent unretired initial seed that still has an orphan descendant blocks clear.
    f.files.delete(f.key(tempPath));
    jest.mocked(plat.descendants).mockResolvedValueOnce({
      status: 'ok',
      identities: [orphan],
    });
    await expect(store.verifyClearable()).resolves.toMatchObject({
      clearable: false,
      reason: 'PROCESSES_STILL_ACTIVE',
    });

    // Unconfirmed verifyGone (e.g. PID reuse check) blocks clear.
    jest.mocked(plat.descendants).mockResolvedValueOnce({
      status: 'ok',
      identities: [],
    });
    jest.mocked(plat.verifyGone).mockResolvedValueOnce('unconfirmed');
    await expect(store.verifyClearable()).resolves.toMatchObject({
      clearable: false,
      reason: 'PROCESSES_STILL_ACTIVE',
    });

    // Every non-closed crash barrier yields UNRESOLVED_NATIVE_SESSION; closed yields UNFINALIZED_JOURNAL.
    for (const phase of [
      'launching',
      'supervisor_ready',
      'bridge_starting',
      'bridge_ready',
      'initial_running',
      'initial_finished',
      'shell_starting',
      'shell_running',
      'stopping',
    ] as const) {
      f.files.set(f.key(journalPath), {
        content: JSON.stringify(makeSnapshot({ phase })),
      });
      await expect(store.evaluateOnStartup()).resolves.toMatchObject({
        active: true,
        reason: 'UNRESOLVED_NATIVE_SESSION',
      });
    }
    f.files.set(f.key(journalPath), {
      content: JSON.stringify(makeSnapshot({ phase: 'closed' })),
    });
    await expect(store.evaluateOnStartup()).resolves.toMatchObject({
      active: true,
      reason: 'UNFINALIZED_JOURNAL',
    });
  });

  it('rejects invalid schema/persist hazards and directory symlinks during removeMarkers', async () => {
    const f = fakeFs();
    const store = createNativeRecoveryStore({
      dataDir,
      platform: 'win32',
      fs: f.fs,
      console: fakePlatform(),
    });

    for (const invalid of [
      { ...makeSnapshot(), schema: 2 },
      { ...makeSnapshot(), generation: 0 },
      { ...makeSnapshot(), entries: { ...makeSnapshot().entries, bad: 'x' } },
      { ...makeSnapshot(), phase: 'bogus' },
      { ...makeSnapshot(), termination: 'bogus' },
      {
        ...makeSnapshot(),
        identities: {
          unknownRole: {
            pid: 1,
            creationTime: 't',
            executablePath: 'C:\\x.exe',
            parentPid: null,
          },
        },
      },
    ]) {
      f.files.set(f.key(journalPath), { content: JSON.stringify(invalid) });
      await expect(store.evaluateOnStartup()).resolves.toMatchObject({
        active: true,
        reason: 'CORRUPT_OR_PARTIAL_JOURNAL',
        snapshot: null,
      });
    }
    f.files.delete(f.key(journalPath));

    f.files.set(f.key(tempPath), { content: 'stale' });
    await expect(store.persist(makeSnapshot())).rejects.toThrow(
      /temp journal/i,
    );
    f.files.delete(f.key(tempPath));

    await expect(
      store.persist(makeSnapshot({ fingerprint: 'a'.repeat(300_000) })),
    ).rejects.toThrow(/size limit/i);

    const renameFail = jest
      .spyOn(f.fs, 'rename')
      .mockRejectedValueOnce(new Error('rename EACCES'));
    await expect(store.persist(makeSnapshot())).rejects.toThrow(
      'rename EACCES',
    );
    renameFail.mockRestore();

    // Symlinked dataDir must reject removeMarkers instead of unlinking inside a junction target.
    f.files.set(f.key(dataDir), { content: '', dir: true, symlink: true });
    await expect(store.removeMarkers()).rejects.toThrow(
      /Unsafe native recovery directory/i,
    );
  });
});
