import { execa } from 'execa';
import { PackageManagersService } from '@/package-managers/package-managers.service';
import {
  deferred,
  flushPmJobs,
  pmLifecycleFixture,
  pmUuid,
} from '@/package-managers/__fixtures__/pm-lifecycle.fixture';
import { root, key } from '@/npm-runner/__fixtures__/runner-test.fixture';
import type { IPmCommitResult } from '@/package-managers/interfaces/pm.runtime';

jest.mock('execa', () => ({
  execa: jest.fn(() => {
    throw new Error('TEST child forbidden');
  }),
}));
// Expected RED: service absent; gate races, preflight refusal, replay, invalidation/audit/stop/shutdown.
describe('M9 service PC admission and finalization', () => {
  const setup = () => {
    const f = pmLifecycleFixture();
    return { ...f, service: new PackageManagersService(f.runtime) };
  };
  type Fixture = ReturnType<typeof setup>;
  const ready = async (f: Fixture) => {
    await f.service.preview({
      requestId: pmUuid(1),
      path: root,
      manager: 'npm',
      targetVersion: 'latest',
    });
    await flushPmJobs();
    const preview = f.service.getLatest()?.preview;
    if (!preview) throw new Error('TEST expected preview');
    return {
      requestId: pmUuid(2),
      previewId: preview.previewId,
      confirm: true as const,
      acknowledgedRisks: preview.risk.reasons.map((reason) => reason.code),
    };
  };
  afterEach(() => {
    expect(execa).not.toHaveBeenCalled();
    jest.clearAllMocks();
  });
  it('GET stays static; catalog metadata never escapes, cancel reads has no audit', async () => {
    const f = setup();
    await f.service.getProject(root);
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
    const waiting =
      deferred<Awaited<ReturnType<typeof f.getPackageMetadata>>>();
    f.getPackageMetadata.mockReturnValueOnce(waiting.promise);
    const start = await f.service.versions({
      requestId: pmUuid(3),
      path: root,
      manager: 'npm',
    });
    await f.service.cancel(start.jobId);
    waiting.resolve({
      versions: ['11.17.0'],
      distTags: { latest: '11.17.0' },
      deprecatedVersions: [],
    });
    await flushPmJobs();
    expect(f.audit.write).not.toHaveBeenCalled();
    expect(f.service.getJob(start.jobId)).toMatchObject({
      phase: 'done',
      status: 'cancelled',
    });
  });
  it('reserves gate before returning and replays a lost execute exactly once', async () => {
    const f = setup();
    const input = await ready(f);
    const pending = f.service.execute(input);
    expect(f.gate.isBusy()).toBe(true);
    expect(f.service.getLatest()).toMatchObject({
      requestId: input.requestId,
      phase: 'preflight',
    });
    const accepted = await pending;
    await f.service.waitForPreflight(accepted.jobId);
    await flushPmJobs();
    expect(f.service.getLatest()).toMatchObject({
      phase: 'done',
      status: 'completed',
      fileCommitted: true,
      gateHeld: false,
      auditWritten: true,
    });
    const count = f.getPackageMetadata.mock.calls.length;
    expect((await f.service.execute(input)).jobId).toBe(accepted.jobId);
    expect(f.rename).toHaveBeenCalledTimes(1);
    expect(f.getPackageMetadata).toHaveBeenCalledTimes(count);
    await expect(
      f.service.execute({ ...input, confirmText: 'different' }),
    ).rejects.toMatchObject({ details: { reason: 'REQUEST_MISMATCH' } });
    await expect(
      f.service.execute({ ...input, requestId: pmUuid(4) }),
    ).rejects.toMatchObject({ details: { reason: 'PREVIEW_CONSUMED' } });
    expect(f.events.indexOf('rename')).toBeGreaterThan(-1);
    expect(f.audit.write.mock.calls.map((call) => call[1])).toEqual([
      'intent',
      'result',
    ]);
  });
  it.each([
    'hasRunningScan',
    'hasRunningMeasurement',
    'hasRunningPreview',
    'hasRunningAnalysis',
  ] as const)('rejects reader %s before a write', async (reader) => {
    const f = setup();
    const input = await ready(f);
    f.readers[reader].mockReturnValue(true);
    const start = await f.service.execute(input);
    await expect(f.service.waitForPreflight(start.jobId)).rejects.toMatchObject(
      { statusCode: 409, details: { reason: 'READERS_RUNNING' } },
    );
    await flushPmJobs();
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.gate.isBusy()).toBe(false);
  });
  it('changed tag and scan are HTTP preflight conflicts with no commit', async () => {
    const f = setup();
    const input = await ready(f);
    f.getPackageMetadata.mockResolvedValue({
      versions: ['11.16.0', '11.17.0', '11.18.0'],
      distTags: { latest: '11.18.0' },
      deprecatedVersions: [],
    });
    const start = await f.service.execute(input);
    await expect(f.service.waitForPreflight(start.jobId)).rejects.toMatchObject(
      { details: { reason: 'PREVIEW_CHANGED' } },
    );
    await flushPmJobs();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('intent failure prevents writing; result failure holds gate until cleanup-only retry', async () => {
    const f = setup();
    const input = await ready(f);
    f.audit.write.mockRejectedValue(new Error('TEST disk full'));
    const start = await f.service.execute(input);
    await f.service.waitForPreflight(start.jobId);
    await flushPmJobs();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.gate.isBusy()).toBe(true);
    await expect(
      f.service.versions({ requestId: pmUuid(5), path: root, manager: 'npm' }),
    ).rejects.toMatchObject({ details: { reason: 'RUNNING' } });
    f.audit.write.mockResolvedValue();
    await f.service.cancel(start.jobId);
    await flushPmJobs();
    expect(f.gate.isBusy()).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('invalidates possible commits and preserves ambiguous failure flags; retry never renames', async () => {
    const f = setup();
    const input = await ready(f);
    f.commit.mockResolvedValue({
      mutationStarted: true,
      mayHaveChanged: true,
      fileCommitted: false,
      observedPin: null,
      cleanupRequired: false,
      failureCode: 'MANIFEST_WRITE_FAILED',
      temp: null,
    });
    f.invalidate.mockRejectedValueOnce(new Error('TEST refresh failed'));
    const start = await f.service.execute(input);
    await f.service.waitForPreflight(start.jobId);
    await flushPmJobs();
    expect(f.service.getLatest()).toMatchObject({
      mayHaveChanged: true,
      fileCommitted: false,
      refreshRequired: true,
      gateHeld: true,
    });
    await f.service.cancel(start.jobId);
    await flushPmJobs();
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.invalidate).toHaveBeenCalledTimes(2);
    expect(f.gate.isBusy()).toBe(false);
    expect(f.service.getLatest()?.failureCode).toBe('MANIFEST_WRITE_FAILED');
  });
  it('cancel holds unsettled write IO and shutdown stops admission until settlement', async () => {
    const f = setup();
    const input = await ready(f);
    const io = deferred<IPmCommitResult>();
    f.commit.mockReturnValue(io.promise);
    const start = await f.service.execute(input);
    await f.service.waitForPreflight(start.jobId);
    await flushPmJobs();
    await f.service.cancel(start.jobId);
    const closing = f.service.onModuleDestroy();
    expect(f.gate.isBusy()).toBe(true);
    await expect(
      f.service.versions({ requestId: pmUuid(8), path: root, manager: 'npm' }),
    ).rejects.toMatchObject({ details: { reason: 'SHUTDOWN' } });
    io.resolve({
      mutationStarted: true,
      mayHaveChanged: true,
      fileCommitted: true,
      observedPin: 'npm@11.17.0',
      cleanupRequired: false,
      failureCode: null,
      temp: null,
    });
    await closing;
    expect(f.gate.isBusy()).toBe(false);
    expect(f.service.getLatest()?.status).toBe('completed');
  });
  it.each(['EBUSY', 'EPERM', 'EACCES'] as const)(
    'preserves proven-intact rename failure %s without invalidation',
    async (code) => {
      const f = setup();
      const input = await ready(f);
      f.rename.mockRejectedValue(
        Object.assign(new Error('TEST locked'), { code }),
      );
      const start = await f.service.execute(input);
      await f.service.waitForPreflight(start.jobId);
      await flushPmJobs();
      expect(f.service.getLatest()).toMatchObject({
        status: 'failed',
        fileCommitted: false,
        mayHaveChanged: false,
        failureCode: code === 'EACCES' ? 'ACCESS_DENIED' : 'FILE_IN_USE',
        gateHeld: false,
      });
      expect(f.invalidate).not.toHaveBeenCalled();
    },
  );
  it('keeps a failed owned-temp cleanup for explicit retry and never retries rename', async () => {
    const f = setup();
    const input = await ready(f);
    f.rename.mockRejectedValue(
      Object.assign(new Error('TEST locked'), { code: 'EBUSY' }),
    );
    f.unlink.mockRejectedValueOnce(new Error('TEST cleanup unavailable'));
    const start = await f.service.execute(input);
    await f.service.waitForPreflight(start.jobId);
    await flushPmJobs();
    expect(f.service.getLatest()).toMatchObject({
      gateHeld: true,
      cleanupRequired: true,
      failureCode: 'FILE_IN_USE',
      mayHaveChanged: false,
    });
    expect(f.cleanupTemp).not.toHaveBeenCalled();
    await f.service.cancel(start.jobId);
    await flushPmJobs();
    expect(f.cleanupTemp).toHaveBeenCalledTimes(1);
    expect(f.rename).toHaveBeenCalledTimes(1);
    expect(f.service.getLatest()).toMatchObject({
      gateHeld: false,
      cleanupRequired: false,
      failureCode: 'FILE_IN_USE',
    });
  });
  it('rechecks TTL after awaited fetch and at the post-202 local write boundary', async () => {
    const f = setup();
    const input = await ready(f);
    const original = f.getPackageMetadata.getMockImplementation()!;
    f.getPackageMetadata.mockImplementationOnce(() => {
      f.advance(300_000);
      return original();
    });
    const start = await f.service.execute(input);
    await expect(f.service.waitForPreflight(start.jobId)).rejects.toMatchObject(
      { details: { reason: 'PREVIEW_EXPIRED' } },
    );
    await flushPmJobs();
    expect(f.commit).not.toHaveBeenCalled();
    const next = setup();
    const nextInput = await ready(next);
    next.audit.write.mockImplementation((_job, phase) => {
      if (phase === 'intent') next.advance(300_000);
      return Promise.resolve();
    });
    const nextStart = await next.service.execute(nextInput);
    await next.service.waitForPreflight(nextStart.jobId);
    await flushPmJobs();
    expect(next.service.getLatest()).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_EXPIRED',
      fileCommitted: false,
      gateHeld: false,
    });
    expect(next.commit).not.toHaveBeenCalled();
  });
  it('rejects medium-risk consent before leasing the gate', async () => {
    const f = setup();
    f.put(`${root}\\.git\\HEAD`, 'TEST inert activity');
    const file = key(`${root}\\.git\\HEAD`);
    f.stats.set(file, {
      ...f.stats.get(file)!,
      mtimeMs: f.runtime.now().getTime(),
    });
    const input = await ready(f);
    expect(input.acknowledgedRisks).toEqual(['RECENTLY_ACTIVE']);
    await expect(
      f.service.execute({ ...input, acknowledgedRisks: [] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(f.gate.isBusy()).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('stops immediately when cancel audit fails and retains the gate for audit-only retry', async () => {
    const f = setup();
    const input = await ready(f);
    const catalog =
      deferred<Awaited<ReturnType<typeof f.getPackageMetadata>>>();
    const entered = deferred<void>();
    f.getPackageMetadata.mockImplementationOnce(() => {
      entered.resolve();
      return catalog.promise;
    });
    const start = await f.service.execute(input);
    await entered.promise;
    f.audit.write.mockImplementation((_job, _phase, _details, operation) =>
      operation === 'cancel'
        ? Promise.reject(new Error('TEST cancel audit failed'))
        : Promise.resolve(),
    );
    await f.service.cancel(start.jobId);
    expect(f.service.getLatest()?.cancelRequested).toBe(true);
    expect(f.gate.isBusy()).toBe(true);
    catalog.resolve({
      versions: ['11.17.0'],
      distTags: { latest: '11.17.0' },
      deprecatedVersions: [],
    });
    await f.service.waitForPreflight(start.jobId);
    await flushPmJobs();
    expect(f.service.getLatest()).toMatchObject({
      status: 'cancelled',
      gateHeld: true,
      cleanupRequired: true,
    });
    f.audit.write.mockResolvedValue();
    await f.service.cancel(start.jobId);
    await flushPmJobs();
    expect(f.gate.isBusy()).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.getPackageMetadata).toHaveBeenCalledTimes(2);
  });
  it('settles HTTP preflight when admission has already exhausted its configured deadline', async () => {
    const f = setup();
    const input = await ready(f);
    f.runtime.timeoutMs = 1000;
    let calls = 0;
    // Store freshness and job admission are at 0; timer arming observes expiry.
    f.runtime.monotonicNow = () => (++calls < 3 ? 0 : 1000);
    const start = await f.service.execute(input);
    await f.service.waitForPreflight(start.jobId);
    await flushPmJobs();
    expect(f.service.getLatest()).toMatchObject({
      status: 'timed_out',
      phase: 'done',
      gateHeld: false,
      failureCode: 'TIMED_OUT',
    });
    expect(f.commit).not.toHaveBeenCalled();
  });
});
