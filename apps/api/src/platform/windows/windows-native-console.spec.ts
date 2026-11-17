import { createWindowsNativeConsole } from './windows-native-console';
import type { IRunnerFs } from '../../npm-runner/interfaces/npm-runner.types';
import type { IProcessInfo } from '../interfaces/process-snapshot.interface';

const node = 'C:\\node\\node.exe';
const created = '2026-11-17T00:00:00.000Z';
const processInfo = (pid: number, parentPid = 1): IProcessInfo => ({
  pid,
  parentPid,
  creationTime: created,
  executablePath: node,
  name: 'node.exe',
  commandLine: null,
});
function setup() {
  const stat = {
    dev: 1,
    ino: 2,
    size: 3,
    mtimeMs: 4,
    ctimeMs: 5,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const fs = {
    lstat: jest.fn().mockResolvedValue(stat),
    realpath: jest.fn((path: string) => Promise.resolve(path)),
  };
  const capture = jest.fn().mockResolvedValue({ status: 'ok', processes: [] });
  const processes = {
    capture: jest.fn(),
    descendants: jest.fn(),
    stopTree: jest.fn().mockResolvedValue('attempted'),
    verifyGone: jest.fn().mockResolvedValue('verified'),
  };
  const adapter = createWindowsNativeConsole({
    fs: fs as unknown as IRunnerFs,
    snapshot: { capture },
    processes,
    platform: 'win32',
    execPath: node,
    systemRoot: 'C:\\Windows',
    appInstallDir: 'C:\\PkgSteward',
  });
  return { adapter, fs, stat, capture, processes };
}
describe('Windows native console preflight and process ownership', () => {
  it('pins Node, both compiled entries and exact selected shell', async () => {
    const { adapter, fs } = setup();
    const result = await adapter.preflight('cmd');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.value).toMatchObject({
      execPath: node,
      supervisorFile:
        'C:\\PkgSteward\\dist\\npm-runner\\native-session\\native-console-supervisor.js',
      bridgeFile:
        'C:\\PkgSteward\\dist\\npm-runner\\native-session\\native-console-entry.js',
      shellFile: 'C:\\Windows\\System32\\cmd.exe',
      shellArgs: ['/d'],
    });
    expect(fs.lstat).toHaveBeenCalledTimes(8);
    expect(await adapter.revalidate(result.value)).toBe(true);
    fs.lstat.mockResolvedValue({ ...setup().stat, ino: 8 });
    expect(await adapter.revalidate(result.value)).toBe(false);
  });
  it('rejects symlinks and realpath substitutions', async () => {
    const { adapter, fs, stat } = setup();
    fs.lstat.mockResolvedValue({ ...stat, isSymbolicLink: () => true });
    expect(await adapter.preflight('cmd')).toEqual({ status: 'unavailable' });
    fs.lstat.mockResolvedValue(stat);
    fs.realpath.mockResolvedValue('C:\\attacker\\node.exe');
    expect(await adapter.preflight('cmd')).toEqual({ status: 'unavailable' });
  });
  it('captures executable path and parent and rejects duplicate or missing metadata', async () => {
    const { adapter, capture } = setup();
    capture.mockResolvedValue({ status: 'ok', processes: [processInfo(10)] });
    expect(await adapter.capture(10, node, 1)).toEqual({
      status: 'ok',
      identity: {
        pid: 10,
        creationTime: created,
        executablePath: node,
        parentPid: 1,
      },
    });
    expect(await adapter.capture(10, node, 2)).toEqual({ status: 'unknown' });
    capture.mockResolvedValue({
      status: 'ok',
      processes: [processInfo(10), processInfo(10)],
    });
    expect(await adapter.capture(10, node, 1)).toEqual({ status: 'unknown' });
    capture.mockResolvedValue({
      status: 'ok',
      processes: [{ ...processInfo(10), executablePath: null }],
    });
    expect(await adapter.capture(10, node, 1)).toEqual({ status: 'unknown' });
  });
  it('discovers orphan children from absent unretired seeds; retired seeds are excluded', async () => {
    const { adapter, capture } = setup();
    const root = {
      ...processInfo(10),
      executablePath: node,
      creationTime: created,
      parentPid: 1,
    };
    capture.mockResolvedValue({
      status: 'ok',
      processes: [
        processInfo(10),
        processInfo(11, 10),
        { ...processInfo(20), creationTime: '2026-11-17T00:00:01.000Z' },
        processInfo(21, 20),
      ],
    });
    const result = await adapter.descendants([root], []);
    expect(result.status).toBe('ok');
    if (result.status === 'ok')
      expect(result.identities.map((id) => id.pid)).toEqual([11]);
    capture.mockResolvedValue({
      status: 'ok',
      processes: [processInfo(11, 10)],
    });
    expect(await adapter.descendants([root], [])).toEqual({
      status: 'ok',
      identities: [
        { pid: 11, parentPid: 10, creationTime: created, executablePath: node },
      ],
    });
    expect(await adapter.descendants([], [])).toEqual({
      status: 'ok',
      identities: [],
    });
    expect(await adapter.verifyGone([])).toBe('verified');
  });
  it('never sends reused unrelated identities to the kill primitive', async () => {
    const { adapter, capture, processes } = setup();
    const identity = {
      pid: 10,
      creationTime: created,
      executablePath: node,
      parentPid: 1,
    };
    capture.mockResolvedValue({
      status: 'ok',
      processes: [
        { ...processInfo(10), creationTime: '2026-11-17T00:00:02.000Z' },
      ],
    });
    expect(await adapter.descendants([identity], [])).toEqual({
      status: 'unknown',
    });
    expect(await adapter.stopTree([identity], [])).toBe('unconfirmed');
    expect(processes.stopTree).not.toHaveBeenCalled();
  });
  it('probes Node and compiled entries independently of either selected shell', async () => {
    const { adapter, fs } = setup();
    fs.lstat.mockImplementation((file: string) =>
      /cmd.exe|powershell.exe/i.test(file)
        ? Promise.reject(new Error('missing shell'))
        : Promise.resolve(setup().stat),
    );
    expect(await adapter.capability()).toBe(true);
    expect(await adapter.preflight('cmd')).toEqual({ status: 'unavailable' });
    expect(await adapter.preflight('powershell')).toEqual({
      status: 'unavailable',
    });
  });
});
