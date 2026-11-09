import { ConfigService } from '@nestjs/config';
import * as nativeFs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import {
  createPmRuntime,
  createPmFs,
} from '@/package-managers/execution/pm-runtime';
import type { IPmRuntimeBindings } from '@/package-managers/execution/pm-runtime';
import { pmIoFixture } from '@/package-managers/__fixtures__/pm-io.fixture';
import {
  root,
  nodeFile,
  pnpmPrefix,
  fileStat,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import { NotFoundException } from '@/common/exceptions/app.exception';
import type { IPmJob } from '@/package-managers/interfaces/pm.types';

jest.mock('node:fs/promises', () => ({
  open: jest.fn(),
  lstat: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
}));

function setup() {
  const f = pmIoFixture();
  const token = Symbol('TEST');
  const bindings = {
    fs: f.fs,
    scanner: {
      getLatest: jest.fn(() => f.scan),
      hasRunningScan: jest.fn(() => false),
      refreshProject: jest.fn(() => Promise.resolve()),
    },
    disk: { hasRunningMeasurement: jest.fn(() => false) },
    fileOps: { hasRunningPreview: jest.fn(() => false) },
    projects: {
      hasRunningAnalysis: jest.fn(() => false),
      invalidateAfterMutation: jest.fn(),
    },
    gate: {
      assertIdle: jest.fn(),
      tryEnter: jest.fn(() => token),
      leave: jest.fn(),
    },
    audit: { append: jest.fn(() => Promise.resolve()) },
    guard: {
      assertAllowed: jest.fn((file: string) =>
        Promise.resolve({
          inputPath: file,
          resolvedPath: file,
          realPath: file,
        }),
      ),
    },
    registry: {
      getPackageMetadata: jest.fn(() =>
        Promise.resolve({
          versions: ['11.17.0'],
          distTags: { latest: '11.17.0' },
        }),
      ),
    },
    config: new ConfigService<Record<string | symbol, unknown>>({
      SCAN_ROOT_PATHS: 'D:\\TEST',
      NPM_COMMAND_TIMEOUT_MS: '',
    }),
    host: { platform: 'win32', execPath: nodeFile, env: { PATH: pnpmPrefix } },
  } satisfies IPmRuntimeBindings;
  return { ...f, bindings, runtime: createPmRuntime(bindings), token };
}
describe('M9 runtime composition', () => {
  it('adapts native wx/writeFile/sync/close/rename/unlink and preserves read-handle nlink', async () => {
    jest.clearAllMocks();
    const stat = { ...fileStat(3), nlink: 1 };
    const handle = {
      stat: jest.fn(() => Promise.resolve(stat)),
      writeFile: jest.fn(() => Promise.resolve()),
      sync: jest.fn(() => Promise.resolve()),
      close: jest.fn(() => Promise.resolve()),
    };
    jest
      .mocked(nativeFs.open)
      .mockResolvedValue(handle as unknown as FileHandle);
    const fs = createPmFs();
    expect(nativeFs.open).not.toHaveBeenCalled();
    const writer = await fs.openExclusive('TEST-temp', 'wx');
    expect(nativeFs.open).toHaveBeenCalledWith('TEST-temp', 'wx');
    const bytes = Buffer.from('TEST');
    await writer.write(bytes);
    await writer.sync();
    await writer.close();
    expect(handle.writeFile).toHaveBeenCalledWith(bytes);
    expect(handle.sync).toHaveBeenCalledTimes(1);
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect((await writer.stat()).nlink).toBe(1);
    const reader = await fs.open('TEST-read');
    expect(nativeFs.open).toHaveBeenCalledWith('TEST-read', 'r');
    expect((await reader.stat()).nlink).toBe(1);
    await reader.close();
    await fs.rename('TEST-temp', 'TEST-manifest');
    await fs.unlink('TEST-temp');
    expect(nativeFs.rename).toHaveBeenCalledWith('TEST-temp', 'TEST-manifest');
    expect(nativeFs.unlink).toHaveBeenCalledWith('TEST-temp');
  });
  it('constructs without IO, network, writes or eager tool detection', () => {
    const f = setup();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.lstat).not.toHaveBeenCalled();
    expect(f.openExclusive).not.toHaveBeenCalled();
    expect(f.bindings.registry.getPackageMetadata).not.toHaveBeenCalled();
    expect(f.runtime.timeoutMs).toBeUndefined();
    expect(createPmFs).toBeInstanceOf(Function);
  });
  it('shares the supplied gate and all four existing reader predicates', () => {
    const f = setup();
    expect(f.runtime.gate.tryEnter()).toBe(f.token);
    f.runtime.gate.leave(f.token);
    expect(f.bindings.gate.leave).toHaveBeenCalledWith(f.token);
    for (const check of Object.values(f.runtime.readers))
      expect(check()).toBe(false);
    expect(f.bindings.scanner.hasRunningScan).toHaveBeenCalledTimes(1);
    expect(f.bindings.disk.hasRunningMeasurement).toHaveBeenCalledTimes(1);
    expect(f.bindings.fileOps.hasRunningPreview).toHaveBeenCalledTimes(1);
    expect(f.bindings.projects.hasRunningAnalysis).toHaveBeenCalledTimes(1);
  });
  it('guards idle before context; resolves tools statically with partial availability and Yarn unsupported', async () => {
    const f = setup();
    f.installTool('npm');
    const facts = await f.runtime.readProject(
      root,
      new AbortController().signal,
    );
    expect(f.bindings.gate.assertIdle).toHaveBeenCalledTimes(1);
    expect(facts.context.installed[0].status).toBe('available');
    expect(facts.context.installed[1].status).toBe('unavailable');
    expect(facts.context.installed[2].status).toBe('unsupported');
    expect(f.bindings.registry.getPackageMetadata).not.toHaveBeenCalled();
  });
  it('maps no scan to null and captures the initial PATH snapshot', () => {
    const f = setup();
    f.bindings.scanner.getLatest.mockImplementation(() => {
      throw new NotFoundException('Latest scan');
    });
    expect(
      f.runtime.projectDeps(new AbortController().signal).getScanSnapshot(),
    ).toBeNull();
    expect(
      f.runtime.projectDeps(new AbortController().signal).scanRoots,
    ).toEqual(['D:\\TEST']);
  });
  it('retains its initial PATH and never mutates the source scan snapshot', async () => {
    const f = setup();
    f.installTool('npm');
    f.installTool('pnpm');
    f.bindings.host.env = { PATH: 'D:\\TEST\\different' };
    const facts = await f.runtime.readProject(
      root,
      new AbortController().signal,
    );
    expect(
      facts.context.installed
        .slice(0, 2)
        .every((tool) => tool.status === 'available'),
    ).toBe(true);
    const scan = f.runtime
      .projectDeps(new AbortController().signal)
      .getScanSnapshot()!;
    scan.projects.length = 0;
    expect(f.scan.projects).toHaveLength(1);
  });
  it('writes bounded actual mutation audit fields to the canonical manifest target', async () => {
    const f = setup();
    const job: IPmJob = {
      jobId: 'TEST-job',
      requestId: 'TEST-request',
      previewId: null,
      status: 'completed',
      kind: 'mutation',
      path: root,
      manager: 'npm',
      phase: 'done',
      startedAt: 'TEST',
      finishedAt: 'TEST',
      cancelRequested: false,
      mutationStarted: true,
      fileCommitted: true,
      mayHaveChanged: true,
      gateHeld: true,
      auditWritten: false,
      refreshRequired: false,
      cleanupRequired: false,
      failureCode: null,
      warnings: [],
      preview: null,
      versions: null,
    };
    await f.runtime.audit.write(job, 'result', {
      risk: { level: 'low', reasons: [] },
      oldPin: 'npm@11.16.0',
      targetPin: 'npm@11.17.0',
      observedPin: 'npm@11.17.0',
    });
    expect(f.bindings.audit.append).toHaveBeenCalledWith({
      operation: 'package-managers.project-pin',
      operationId: 'TEST-job',
      phase: 'result',
      targets: [`${root}\\package.json`],
      method: 'manifest-pin',
      risk: { level: 'low', codes: [] },
      errorCode: null,
      result: JSON.stringify({
        status: 'completed',
        old: 'npm@11.16.0',
        target: 'npm@11.17.0',
        observed: 'npm@11.17.0',
        mutationStarted: true,
        fileCommitted: true,
        mayHaveChanged: true,
        cancelRequested: false,
        refreshRequired: false,
        cleanupRequired: false,
      }),
    });
  });
  it('invalidates scanner and projects even if the first invalidation fails', async () => {
    const f = setup();
    f.bindings.scanner.refreshProject.mockImplementation(() =>
      Promise.reject(new Error('TEST failure')),
    );
    await expect(f.runtime.invalidate(root)).rejects.toMatchObject({
      details: { reason: 'CACHE_INVALIDATION_FAILED' },
    });
    expect(f.bindings.projects.invalidateAfterMutation).toHaveBeenCalledWith(
      root,
    );
  });
  it('keeps per-job signal isolation and a configured timeout without creating timers on construction', () => {
    const f = setup();
    const a = new AbortController();
    const b = new AbortController();
    a.abort();
    expect(f.runtime.projectDeps(a.signal).signal.aborted).toBe(true);
    expect(f.runtime.projectDeps(b.signal).signal.aborted).toBe(false);
    const runtime = createPmRuntime({
      ...f.bindings,
      config: new ConfigService<Record<string | symbol, unknown>>({
        NPM_COMMAND_TIMEOUT_MS: 1500,
      }),
    });
    expect(runtime.timeoutMs).toBe(1500);
  });
});
