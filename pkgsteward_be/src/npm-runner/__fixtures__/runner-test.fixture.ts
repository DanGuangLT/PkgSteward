import { readFileSync } from 'node:fs';
import { join, win32 as path } from 'node:path';
import type {
  IProjectFileStat,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';
import type {
  IRunnerFileHandle,
  IRunnerFs,
  IRunnerInput,
  IRunnerInputDeps,
  IRunnerTool,
  IRunnerToolSnapshot,
  RunnerManager,
} from '@/npm-runner/interfaces/npm-runner.types';

export const root = 'D:\\TEST\\project';
export const nodeFile = 'C:\\Program Files\\nodejs\\node.exe';
export const npmDir = 'C:\\Program Files\\nodejs\\node_modules\\npm';
export const pnpmPrefix = 'C:\\Users\\TEST\\AppData\\Roaming\\npm';
export const key = (value: string) => path.resolve(value).toLowerCase();
export const fileStat = (
  size = 0,
  overrides: Partial<IProjectFileStat> = {},
): IProjectFileStat => ({
  size,
  ino: 2,
  dev: 1,
  mtimeMs: 1,
  ctimeMs: 1,
  isFile: () => true,
  isSymbolicLink: () => false,
  isDirectory: () => false,
  ...overrides,
});
export const tool = (manager: RunnerManager = 'npm'): IRunnerTool => {
  const packageDir =
    manager === 'npm' ? npmDir : path.join(pnpmPrefix, 'node_modules', 'pnpm');
  const entry = path.join(
    packageDir,
    'bin',
    manager === 'npm' ? 'npm-cli.js' : 'pnpm.mjs',
  );
  return {
    manager,
    version: manager === 'npm' ? '11.17.0' : '11.22.0',
    file: nodeFile,
    entry,
    packageDir,
    identities: [nodeFile, entry, path.join(packageDir, 'package.json')].map(
      (file) => ({ path: file, stat: fileStat() }),
    ),
  };
};
export const runnerInput = (manager: RunnerManager = 'npm'): IRunnerInput => ({
  requestPath: root,
  path: root,
  scanId: '00000000-0000-4000-8000-000000000001',
  inputHash: 'a'.repeat(64),
  manifest: {
    name: 'TEST-project',
    version: '1.0.0',
    packageManager: null,
    dependencies: [
      {
        name: 'alpha',
        declarations: [{ group: 'dependencies', spec: '^1.0.0' }],
      },
    ],
    scripts: [{ name: 'dev', command: 'echo TEST' }],
  },
  scripts: { dev: 'echo TEST' },
  manager,
  tool: tool(manager),
  reason: null,
  warnings: [],
  workspace: { kind: 'standalone', root: null },
  lockFiles: [],
  identities: [],
});

export const fsFixture = () => {
  const files = new Map<string, Buffer>();
  const stats = new Map<string, IProjectFileStat>();
  const realpaths = new Map<string, string>();
  const openedStats = new Map<string, IProjectFileStat>();
  const events: string[] = [];
  const controller = new AbortController();
  let after: ((event: string) => void) | undefined;
  const record = (event: string) => {
    events.push(event);
    after?.(event);
  };
  const errno = (code: string) =>
    Object.assign(new Error(`TEST ${code}`), { code });
  const directory = (value: string) =>
    stats.set(
      key(value),
      fileStat(0, { isFile: () => false, isDirectory: () => true }),
    );
  const put = (value: string, text: string) => {
    const absolute = key(value);
    files.set(absolute, Buffer.from(text));
    stats.set(absolute, fileStat(Buffer.byteLength(text)));
    for (let parent = path.dirname(absolute); ; parent = path.dirname(parent)) {
      if (!stats.has(parent)) directory(parent);
      if (path.dirname(parent) === parent) break;
    }
  };
  const remove = (value: string) => {
    files.delete(key(value));
    stats.delete(key(value));
  };
  const read = async function* (value: string, signal: AbortSignal) {
    const bytes = files.get(key(value));
    if (!bytes) throw errno('ENOENT');
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      await Promise.resolve();
      signal.throwIfAborted();
      record(`read:${key(value)}`);
      yield bytes.subarray(offset, offset + 65536);
    }
  };
  const lstat = jest.fn((value: string): Promise<IProjectFileStat> => {
    record(`lstat:${key(value)}`);
    const result = stats.get(key(value));
    return result ? Promise.resolve(result) : Promise.reject(errno('ENOENT'));
  });
  const realpath = jest.fn((value: string): Promise<string> => {
    record(`realpath:${key(value)}`);
    return Promise.resolve(realpaths.get(key(value)) ?? path.resolve(value));
  });
  const close = jest.fn((): Promise<void> => Promise.resolve());
  const open = jest.fn((value: string): Promise<IRunnerFileHandle> => {
    record(`open:${key(value)}`);
    if (!files.has(key(value))) return Promise.reject(errno('ENOENT'));
    const opened = openedStats.get(key(value)) ?? stats.get(key(value))!;
    return Promise.resolve({
      stat: () => {
        record(`fstat:${key(value)}`);
        return Promise.resolve(opened);
      },
      readChunks: (signal) => read(value, signal),
      close,
    });
  });
  const readChunks = jest.fn((value: string, signal: AbortSignal) =>
    read(value, signal),
  );
  const fs: IRunnerFs = { lstat, realpath, open, readChunks };
  const snapshot: IRunnerToolSnapshot = {
    platform: 'win32',
    execPath: nodeFile,
    env: { PATH: pnpmPrefix },
    projectPaths: [root],
    signal: controller.signal,
  };
  const installTool = (manager: RunnerManager) => {
    const installed = tool(manager);
    put(installed.file, 'TEST executable bytes, never executed');
    put(
      path.join(installed.packageDir, 'package.json'),
      readFileSync(join(__dirname, 'tools', `${manager}-package.json`), 'utf8'),
    );
    put(installed.entry!, '// TEST distribution entry; never executed');
    return installed;
  };
  const scan: ProjectScanSnapshot = {
    scanId: '00000000-0000-4000-8000-000000000001',
    projects: [
      {
        path: root,
        name: 'TEST-old',
        packageManager: 'yarn',
        hasLockfile: false,
        lastActivityAt: '2026-11-03T00:00:00.000Z',
        nodeModules: {
          exists: false,
          path: path.join(root, 'node_modules'),
          sizeBytes: null,
          sizeMeasuredAt: null,
        },
      },
    ],
  };
  const assertAllowed = jest.fn((value: string): Promise<string> => {
    record(`guard:${key(value)}`);
    return Promise.resolve(realpaths.get(key(value)) ?? path.resolve(value));
  });
  const resolveTool = jest.fn((manager: RunnerManager): Promise<IRunnerTool> =>
    Promise.resolve(tool(manager)),
  );
  const deps: IRunnerInputDeps = {
    platform: 'win32',
    fs,
    signal: controller.signal,
    scanRoots: ['D:\\TEST'],
    assertAllowed,
    getScanSnapshot: () => scan,
    resolveTool,
    now: () => new Date('2026-11-03T03:00:00.000Z'),
  };
  put(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'TEST-project',
      dependencies: { alpha: '^1.0.0' },
      scripts: { dev: 'echo TEST' },
    }),
  );
  return {
    files,
    stats,
    realpaths,
    openedStats,
    events,
    controller,
    put,
    remove,
    directory,
    fs,
    snapshot,
    scan,
    deps,
    lstat,
    realpath,
    open,
    close,
    readChunks,
    assertAllowed,
    resolveTool,
    installTool,
    onEvent: (callback: (event: string) => void) => {
      after = callback;
    },
  };
};
