import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { pmIoFixture } from '@/package-managers/__fixtures__/pm-io.fixture';
import { tool } from '@/npm-runner/__fixtures__/runner-test.fixture';
import {
  readPmProject,
  commitPmPin,
  cleanupPmTemp,
} from '@/package-managers/discovery/pm-project';
import { PmRegistry } from '@/package-managers/discovery/pm-registry';
import type { IPmRuntime } from '@/package-managers/interfaces/pm.runtime';

// TEST only; không phải yêu cầu nghiệp vụ. All project IO and registry are mocked.
export const pmUuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function flushPmJobs() {
  for (let i = 0; i < 5; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
}
export function pmLifecycleFixture(npmVersion = '11.17.0') {
  const io = pmIoFixture();
  io.resolveTool.mockImplementation((manager) =>
    Promise.resolve(tool(manager, manager === 'npm' ? npmVersion : undefined)),
  );
  const npm12 = npmVersion.startsWith('12.');
  if (npm12)
    io.put(io.manifest, '{"name":"TEST-pin","packageManager":"npm@12.2.1"}');
  const gate = new MutationGateService();
  let serial = 100;
  let mono = 0;
  const now = () => new Date('2026-11-09T00:00:00.000Z');
  const getPackageMetadata = jest.fn(() =>
    Promise.resolve({
      versions: npm12
        ? ['11.17.0', '12.2.1', '12.2.2']
        : ['11.16.0', '11.17.0', '11.18.0'],
      distTags: { latest: npm12 ? '12.2.2' : '11.17.0' },
      deprecatedVersions: [] as string[],
    }),
  );
  const audit = {
    write: jest.fn<
      ReturnType<IPmRuntime['audit']['write']>,
      Parameters<IPmRuntime['audit']['write']>
    >(() => Promise.resolve()),
  };
  const commit = jest.fn<
    ReturnType<IPmRuntime['commit']>,
    Parameters<IPmRuntime['commit']>
  >((facts, edit, signal, beforeRename) =>
    commitPmPin(facts, edit, signal, { ...io.deps, signal, beforeRename }),
  );
  const cleanupTemp = jest.fn<
    ReturnType<IPmRuntime['cleanupTemp']>,
    Parameters<IPmRuntime['cleanupTemp']>
  >((temp) => cleanupPmTemp(temp, io.deps));
  const invalidate = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
  const readers = {
    hasRunningScan: jest.fn(() => false),
    hasRunningMeasurement: jest.fn(() => false),
    hasRunningPreview: jest.fn(() => false),
    hasRunningAnalysis: jest.fn(() => false),
  };
  const runtime: IPmRuntime = {
    projectDeps: (signal) => ({ ...io.deps, signal, now }),
    readProject: (path, signal) => {
      gate.assertIdle();
      return readPmProject(path, { ...io.deps, signal, now });
    },
    commit,
    cleanupTemp,
    registry: new PmRegistry({ getPackageMetadata }, now),
    gate,
    readers,
    audit,
    invalidate,
    timeoutMs: undefined,
    now,
    monotonicNow: () => mono,
    uuid: () => pmUuid(++serial),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer),
  };
  return {
    ...io,
    runtime,
    gate,
    commit,
    cleanupTemp,
    invalidate,
    readers,
    audit,
    getPackageMetadata,
    advance: (ms: number) => {
      mono += ms;
    },
  };
}
