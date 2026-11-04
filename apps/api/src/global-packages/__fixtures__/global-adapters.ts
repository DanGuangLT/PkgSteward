import { win32 } from 'node:path';
import { AppException } from '@/common/exceptions/app.exception';
import type {
  GlobalProbeSpawn,
  IGlobalProbeResult,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type { GlobalManager } from '@/global-packages/interfaces/global-packages.types';
import type {
  IRunnerFs,
  IRunnerTool,
} from '@/npm-runner/interfaces/npm-runner.types';

// TEST không phải yêu cầu nghiệp vụ. All paths and bytes are inert in-memory data.
export const TEST_PATHS = {
  node: 'C:\\Program Files\\nodejs\\node.exe',
  npm: 'C:\\Program Files\\nodejs\\node_modules\\npm',
  pnpm: 'D:\\TEST\\AppData\\npm\\node_modules\\pnpm',
  prefix: 'D:\\TEST\\prefix',
  global: 'D:\\TEST\\pnpm-global',
  bin: 'D:\\TEST\\pnpm-bin',
  store: 'D:\\TEST\\pnpm-store',
  cache: 'D:\\TEST\\npm-cache',
  userconfig: 'D:\\TEST\\config\\user.npmrc',
  globalconfig: 'D:\\TEST\\config\\global.npmrc',
  data: 'D:\\TEST\\data',
  app: 'D:\\TEST\\app',
  source: 'D:\\TEST\\source',
  profile: 'D:\\TEST\\profile',
  cwd: 'D:\\TEST\\data\\cache\\global-packages-cwd',
} as const;

export function testTool(manager: GlobalManager): IRunnerTool {
  const packageDir = TEST_PATHS[manager];
  return {
    manager,
    version: manager === 'npm' ? '11.17.0' : '11.22.0',
    file: TEST_PATHS.node,
    entry: win32.join(
      packageDir,
      manager === 'npm' ? 'bin/npm-cli.js' : 'bin/pnpm.mjs',
    ),
    packageDir,
    identities: [],
  };
}

export function testLocation(
  manager: GlobalManager = 'npm',
): IGlobalResolvedLocation {
  const npm = manager === 'npm';
  return {
    manager,
    tool: testTool(manager),
    prefix: npm ? TEST_PATHS.prefix : null,
    globalDir: npm ? null : TEST_PATHS.global,
    globalRoot: win32.join(
      npm ? TEST_PATHS.prefix : TEST_PATHS.global,
      'node_modules',
    ),
    binDir: npm ? TEST_PATHS.prefix : TEST_PATHS.bin,
    cacheDir: npm ? TEST_PATHS.cache : null,
    storeDir: npm ? null : TEST_PATHS.store,
    userConfig: TEST_PATHS.userconfig,
    globalConfig: TEST_PATHS.globalconfig,
    configIdentities: [],
    cwd: TEST_PATHS.cwd,
    protectedPaths: [
      TEST_PATHS.npm,
      TEST_PATHS.pnpm,
      TEST_PATHS.node,
      TEST_PATHS.app,
      TEST_PATHS.source,
      TEST_PATHS.data,
    ],
  };
}

export function probeResult(
  value: unknown,
  patch: Partial<IGlobalProbeResult> = {},
): IGlobalProbeResult {
  return {
    stdout: Buffer.from(JSON.stringify(value)),
    stderr: Buffer.alloc(0),
    exitCode: 0,
    terminationVerified: true,
    ...patch,
  };
}

export function testSpawn(): jest.MockedFunction<GlobalProbeSpawn> {
  return jest
    .fn<ReturnType<GlobalProbeSpawn>, Parameters<GlobalProbeSpawn>>()
    .mockResolvedValue(probeResult({}));
}

type FileStat = Awaited<ReturnType<IRunnerFs['lstat']>>;
export interface ITestFile {
  text?: string;
  bytes?: Uint8Array;
  link?: boolean;
  real?: string;
  directory?: boolean;
}
export function memoryFs() {
  const entries = new Map<string, ITestFile>();
  const key = (path: string) => win32.resolve(path).toLowerCase();
  const get = (path: string): ITestFile => {
    const value = entries.get(key(path));
    if (value) return value;
    throw Object.assign(new Error('TEST missing file'), { code: 'ENOENT' });
  };
  const bytes = (entry: ITestFile) =>
    Buffer.from(entry.bytes ?? Buffer.from(entry.text ?? ''));
  const stat = (entry: ITestFile): FileStat => ({
    size: bytes(entry).byteLength,
    dev: 1,
    ino: 1,
    mtimeMs: 1,
    ctimeMs: 1,
    isFile: () => !entry.directory && !entry.link,
    isDirectory: () => !!entry.directory,
    isSymbolicLink: () => !!entry.link,
  });
  const lstat = jest
    .fn<ReturnType<IRunnerFs['lstat']>, Parameters<IRunnerFs['lstat']>>()
    .mockImplementation((path) => Promise.resolve(stat(get(path))));
  const realpath = jest
    .fn<ReturnType<IRunnerFs['realpath']>, Parameters<IRunnerFs['realpath']>>()
    .mockImplementation((path) => Promise.resolve(get(path).real ?? path));
  const open = jest
    .fn<ReturnType<IRunnerFs['open']>, Parameters<IRunnerFs['open']>>()
    .mockImplementation((path) => {
      const entry = get(path);
      return Promise.resolve({
        stat: () => Promise.resolve(stat(entry)),
        async *readChunks(signal: AbortSignal) {
          await Promise.resolve();
          signal.throwIfAborted();
          yield bytes(entry);
        },
        close: () => Promise.resolve(),
      });
    });
  const readdir = jest.fn().mockResolvedValue([]);
  const readFile = jest
    .fn()
    .mockRejectedValue(new Error('TEST use handle-bound reads'));
  const fs = {
    lstat,
    realpath,
    open,
    readdir,
    readFile,
  } as unknown as IRunnerFs;
  const put = (path: string, entry: ITestFile) => {
    entries.set(key(path), entry);
    let parent = win32.dirname(path);
    while (!entries.has(key(parent))) {
      entries.set(key(parent), { directory: true });
      const next = win32.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  };
  return { fs, put, entries, lstat, realpath, open, readdir, readFile };
}

export async function expectGlobalReason(
  run: () => unknown,
  reason: string,
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppException);
  expect((caught as AppException).details).toMatchObject({ reason });
}
