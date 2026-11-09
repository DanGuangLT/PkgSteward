import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  GlobalMutationLaunch,
  GlobalProbeSpawn,
  IGlobalPreviewFacts,
  IGlobalServiceRuntime,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalExecuteRequest,
  IGlobalPreview,
  IGlobalPreviewRequest,
} from '@/global-packages/interfaces/global-packages.types';
import type { IGlobalInventoryResult } from '@/global-packages/discovery/global-inventory';
import type {
  IRunProcess,
  IRunProcessCallbacks,
  IRunProcessExit,
} from '@/npm-runner/execution/runner-process';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';
import { runnerIdentity } from '@/npm-runner/toolchain/runner-tool';
import { getGlobalRisk } from '@/global-packages/policy/global-policy';
import { snapshotGlobalPreviewFacts } from '@/global-packages/policy/global-preview';
import {
  memoryFs,
  TEST_PATHS,
  testLocation,
  testSpawn,
  testTool,
} from '@/global-packages/__fixtures__/global-adapters';

// TEST không phải yêu cầu nghiệp vụ. No real files, processes, network or timers.
export const TEST_REQUEST_ID = '00000000-0000-4000-8000-000000000101';
export const TEST_PREVIEW_ID = '00000000-0000-4000-8000-000000000102';
export const TEST_JOB_ID = '00000000-0000-4000-8000-000000000103';
export const TEST_EXECUTE_ID = '00000000-0000-4000-8000-000000000104';
export const testRequest = (
  patch: Partial<IGlobalPreviewRequest> = {},
): IGlobalPreviewRequest => ({
  requestId: TEST_REQUEST_ID,
  manager: 'npm',
  package: 'test-tool',
  action: 'remove',
  ...patch,
});

export function testIdentity(path: string) {
  const stat = {
    dev: 1,
    ino: 2,
    size: 32,
    mtimeMs: 3,
    ctimeMs: 4,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
  return runnerIdentity(path, stat);
}

export function testConfigIdentity(path: string, text = '') {
  const stat = {
    dev: 1,
    ino: 1,
    size: Buffer.byteLength(text),
    mtimeMs: 1,
    ctimeMs: 1,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
  return {
    file: runnerIdentity(path, stat),
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

export function testFacts(change = false): IGlobalPreviewFacts {
  const location = testLocation();
  const packageRoot = win32.join(location.globalRoot, 'test-tool');
  location.configIdentities = [
    testConfigIdentity(location.userConfig),
    testConfigIdentity(location.globalConfig),
  ];
  location.tool.identities = [testIdentity(location.tool.file)];
  return snapshotGlobalPreviewFacts({
    location,
    current: {
      name: 'test-tool',
      version: '1.0.0',
      packageRoot,
      manifest: {
        file: testIdentity(win32.join(packageRoot, 'package.json')),
        sha256: 'TEST-manifest-hash',
      },
      bins: [{ name: 'test-tool', target: 'bin/tool.js' }],
      binIdentities: [
        testIdentity(win32.join(location.binDir, 'test-tool.cmd')),
      ],
    },
    target: change
      ? {
          name: 'test-tool',
          version: '2.0.0',
          requestedVersion: 'latest',
          manifestHash: 'TEST-target-hash',
          integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
          bins: [{ name: 'test-tool', target: 'dist/tool.js' }],
        }
      : null,
    binOwners: [{ name: 'test-tool', owner: 'test-tool' }],
  });
}

export function testPreview(): IGlobalPreview {
  const facts = testFacts();
  return {
    previewId: TEST_PREVIEW_ID,
    createdAt: '2026-11-04T00:00:00.000Z',
    expiresAt: '2026-11-04T00:05:00.000Z',
    manager: 'npm',
    managerVersion: '11.17.0',
    action: 'remove',
    package: 'test-tool',
    currentVersion: '1.0.0',
    requestedVersion: null,
    targetVersion: null,
    globalRoot: facts.location.globalRoot,
    binDir: facts.location.binDir,
    bins: {
      before: facts.current.bins,
      after: [],
      added: [],
      removed: facts.current.bins,
      replaced: [],
    },
    warningCodes: [
      'GLOBAL_CODE_EXECUTION',
      'GLOBAL_CONSUMERS_UNKNOWN',
      'PROCESS_ESCAPE_RESIDUAL',
    ],
    risk: getGlobalRisk(),
    confirmText: 'REMOVE GLOBAL npm test-tool',
  };
}

export const testConsent = (
  patch: Partial<IGlobalExecuteRequest> = {},
): IGlobalExecuteRequest => ({
  requestId: TEST_EXECUTE_ID,
  previewId: TEST_PREVIEW_ID,
  confirm: true,
  acknowledgedRisks: ['MACHINE_WIDE'],
  confirmText: 'REMOVE GLOBAL npm test-tool',
  ...patch,
});

export function testInventory(facts = testFacts()): IGlobalInventoryResult {
  return {
    packages: [
      {
        name: facts.current.name,
        version: facts.current.version,
        bins: facts.current.bins,
        status: 'manageable',
        reason: null,
      },
    ],
    facts: [facts.current],
    binOwners: facts.binOwners,
    ownershipComplete: true,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function flushJobs(): Promise<void> {
  for (let i = 0; i < 400; i++) await Promise.resolve();
}

export function testClock() {
  let mono = 1000;
  let wall = Date.parse('2026-11-04T00:00:00Z');
  let sequence = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const now = () => new Date(wall);
  const monotonicNow = () => mono;
  const setTimer = jest.fn((callback: () => void, milliseconds: number) => {
    const id = ++sequence;
    timers.set(id, { due: mono + milliseconds, callback });
    return id;
  });
  const clearTimer = jest.fn((handle: unknown) => {
    timers.delete(handle as number);
  });
  const advance = (milliseconds: number) => {
    mono += milliseconds;
    wall += milliseconds;
    for (const [id, timer] of [...timers]) {
      if (timer.due <= mono && timers.delete(id)) timer.callback();
    }
  };
  return {
    now,
    monotonicNow,
    setTimer,
    clearTimer,
    advance,
    timers,
    jumpWall: (milliseconds: number) => {
      wall += milliseconds;
    },
  };
}

export function testProcess() {
  const end = deferred<IRunProcessExit>();
  let callbacks: IRunProcessCallbacks | null = null;
  const stop = jest
    .fn<ReturnType<IRunProcess['stop']>, []>()
    .mockResolvedValue('verified');
  const process: IRunProcess = { pid: 1234, settled: end.promise, stop };
  const launch = jest
    .fn<ReturnType<GlobalMutationLaunch>, Parameters<GlobalMutationLaunch>>()
    .mockImplementation((_command, listeners) => {
      callbacks = listeners;
      return process;
    });
  const exit = (patch: Partial<IRunProcessExit> = {}) => {
    const outcome: IRunProcessExit = {
      exitCode: 0,
      signal: null,
      failureCode: null,
      termination: 'verified',
      outputTruncated: false,
      ...patch,
    };
    callbacks?.onExit(outcome);
    end.resolve(outcome);
    return outcome;
  };
  const output = (stream: 'stdout' | 'stderr', bytes: Buffer) => {
    callbacks?.onOutput(stream, bytes);
  };
  return { process, stop, launch, exit, output, end };
}

export interface ITestGlobalRuntime {
  runtime: IGlobalServiceRuntime;
  clock: ReturnType<typeof testClock>;
  child: ReturnType<typeof testProcess>;
  fs: ReturnType<typeof memoryFs>;
  tryEnter: jest.Mock<symbol | null, []>;
  leave: jest.Mock<void, [symbol]>;
  audit: jest.Mock<Promise<void>, [IAuditRecord]>;
  fetcher: jest.MockedFunction<typeof fetch>;
  probe: jest.MockedFunction<GlobalProbeSpawn>;
  scannedProjectPaths: jest.Mock<readonly string[], []>;
  uuid: jest.Mock<string, []>;
  busy(): boolean;
}

export function testRuntime(): ITestGlobalRuntime {
  const clock = testClock();
  const child = testProcess();
  const fs = memoryFs();
  fs.put(TEST_PATHS.userconfig, { text: '' });
  fs.put(TEST_PATHS.globalconfig, { text: '' });
  const token = Symbol('TEST mutation');
  let owner: symbol | null = null;
  const tryEnter = jest.fn<symbol | null, []>(() => {
    if (owner) return null;
    owner = token;
    return token;
  });
  const leave = jest.fn((value: symbol) => {
    if (value === owner) owner = null;
  });
  const audit = jest
    .fn<Promise<void>, [IAuditRecord]>()
    .mockResolvedValue(undefined);
  const probe = testSpawn();
  const fetcher = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockRejectedValue(new Error('TEST unexpected network'));
  let uuidIndex = 200;
  const uuid = jest.fn(
    () => `00000000-0000-4000-8000-${String(++uuidIndex).padStart(12, '0')}`,
  );
  const scannedProjectPaths = jest.fn(() => [] as readonly string[]);
  const runtime: IGlobalServiceRuntime = {
    fs: fs.fs,
    environment: {},
    platform: 'win32',
    execPath: TEST_PATHS.node,
    paths: {
      cacheDir: win32.join(TEST_PATHS.data, 'cache'),
      appInstallDir: TEST_PATHS.app,
      sourceCheckoutDir: TEST_PATHS.source,
      dataDir: TEST_PATHS.data,
    },
    now: clock.now,
    monotonicNow: clock.monotonicNow,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    timeoutMs: undefined,
    uuid,
    scannedProjectPaths,
    makeDirectory: jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined),
    resolveTool: jest
      .fn<
        ReturnType<IGlobalServiceRuntime['resolveTool']>,
        Parameters<IGlobalServiceRuntime['resolveTool']>
      >()
      .mockImplementation((manager) => Promise.resolve(testTool(manager))),
    probe,
    fetcher,
    launch: child.launch,
    gate: { tryEnter, leave },
    audit: { append: audit },
  };
  return {
    runtime,
    clock,
    child,
    fs,
    tryEnter,
    leave,
    audit,
    fetcher,
    probe,
    scannedProjectPaths,
    uuid,
    busy: () => owner !== null,
  };
}
