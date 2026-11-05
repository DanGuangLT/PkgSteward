import 'reflect-metadata';
import { win32 } from 'node:path';
import { AppException } from '@/common/exceptions/app.exception';
import * as locationAdapter from '@/global-packages/global-location';
import * as inventoryAdapter from '@/global-packages/global-inventory';
import { GlobalRegistry } from '@/global-packages/global-registry';
import { GlobalPackagesService } from '@/global-packages/global-packages.service';
import { readPnpmGlobalConfig } from '@/global-packages/pnpm-global-config';
import type { IGlobalInventoryResult } from '@/global-packages/global-inventory';
import type {
  IGlobalProbeResult,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalManager,
  GlobalReasonCode,
  IGlobalExecuteRequest,
  IGlobalJob,
  IGlobalPreview,
  IGlobalPreviewRequest,
} from '@/global-packages/interfaces/global-packages.types';
import {
  deferred,
  flushJobs,
  testConsent,
  testConfigIdentity,
  testFacts,
  testInventory,
  testRequest,
  testRuntime,
  TEST_EXECUTE_ID,
  TEST_REQUEST_ID,
} from '@/global-packages/__fixtures__/global-lifecycle';
import {
  expectGlobalReason,
  probeResult,
  testLocation,
} from '@/global-packages/__fixtures__/global-adapters';
import { pnpmPreviewFacts } from '@/global-packages/__fixtures__/pnpm11/inventory';
import { PNPM_TEST_PATHS as Q } from '@/global-packages/__fixtures__/pnpm11/facts';
import type { IPnpmGlobalPolicy } from '@/global-packages/interfaces/pnpm-global.types';

// TEST không phải yêu cầu nghiệp vụ. Memory-only service boundary; no host IO.
const emptyPnpmInventory = (): IGlobalInventoryResult => ({
  packages: [],
  facts: [],
  binOwners: [],
  ownershipComplete: true,
  pnpmInventory: {
    groups: [],
    unreferencedDirectories: [],
    ownershipComplete: true,
  },
});

async function finishPnpmJob(
  service: GlobalPackagesService,
  id: string,
): Promise<IGlobalJob> {
  for (let index = 0; index < 2000; index++) {
    const job = service.getJob(id);
    if (job.phase === 'done') return job;
    await Promise.resolve();
  }
  throw new Error('TEST pnpm job did not finish within mocked microtasks');
}

function setupPnpmService(change = false) {
  const fixture = testRuntime();
  const facts = pnpmPreviewFacts();
  const location: IGlobalResolvedLocation = {
    ...testLocation('pnpm'),
    ...facts.location,
  };
  facts.location = location;
  fixture.runtime.environment = {
    PATH: `${Q.bin};C:\\Program Files\\nodejs;C:\\Windows\\System32`,
    PNPM_HOME: Q.home,
  };
  fixture.fs.put(Q.yaml, { text: 'registry: https://registry.npmjs.org/\n' });
  fixture.fs.put(Q.auth, { text: '' });
  location.globalConfig = Q.yaml;
  location.configIdentities = [
    testConfigIdentity(Q.yaml, 'registry: https://registry.npmjs.org/\n'),
    testConfigIdentity(Q.auth),
  ];
  location.pnpm!.configIdentities = [...location.configIdentities];
  const unavailable = new Map<GlobalManager, GlobalReasonCode>();
  const discover = jest
    .spyOn(locationAdapter, 'discoverGlobalLocation')
    .mockImplementation((manager) => {
      const reason = unavailable.get(manager);
      if (reason)
        return Promise.reject(
          new AppException(409, 'TEST manager unavailable', 'CONFLICT', {
            reason,
          }),
        );
      return Promise.resolve(
        manager === 'pnpm'
          ? location
          : { ...testLocation(), ...testFacts().location },
      );
    });
  let before: IGlobalInventoryResult = {
    ...testInventory(facts),
    pnpmInventory: facts.pnpmInventory,
  };
  let after = emptyPnpmInventory();
  const inventory = jest
    .spyOn(inventoryAdapter, 'readGlobalInventory')
    .mockImplementation((resolved) =>
      Promise.resolve(
        resolved.manager === 'npm'
          ? testInventory()
          : fixture.child.launch.mock.calls.length
            ? after
            : before,
      ),
    );
  const versions = jest
    .spyOn(GlobalRegistry.prototype, 'getVersions')
    .mockResolvedValue({
      manager: 'pnpm',
      package: 'is-number',
      versions: ['7.0.0', '8.0.0'],
      tags: { latest: '8.0.0' },
    });
  const targetFacts = {
    ...testFacts(true).target!,
    name: 'is-number',
    version: '8.0.0',
    bins: [],
  };
  const target = jest
    .spyOn(GlobalRegistry.prototype, 'getTarget')
    .mockResolvedValue(targetFacts);
  const service = new GlobalPackagesService(fixture.runtime);
  const request = (
    patch: Partial<IGlobalPreviewRequest> = {},
  ): IGlobalPreviewRequest => ({
    requestId: fixture.uuid(),
    manager: 'pnpm',
    package: 'is-number',
    action: change ? 'change' : 'remove',
    ...(change ? { targetVersion: 'latest' } : {}),
    ...patch,
  });
  const ready = async (): Promise<IGlobalPreview> => {
    const start = await service.preview(request());
    const job = await finishPnpmJob(service, start.jobId);
    expect(job).toMatchObject({ status: 'completed', failureCode: null });
    expect(job.preview).not.toBeNull();
    return job.preview!;
  };
  const consent = (
    preview: IGlobalPreview,
    patch: Partial<IGlobalExecuteRequest> = {},
  ) =>
    testConsent({
      requestId: fixture.uuid(),
      previewId: preview.previewId,
      confirmText: preview.confirmText,
      ...patch,
    });
  return {
    ...fixture,
    service,
    facts,
    location,
    unavailable,
    discover,
    inventory,
    versions,
    target,
    targetFacts,
    request,
    ready,
    consent,
    before: () => before,
    replaceBefore: (value: IGlobalInventoryResult) => {
      before = value;
    },
    post: (value: IGlobalInventoryResult) => {
      after = value;
    },
    config: (text: string) => {
      fixture.fs.put(Q.yaml, { text });
      const identity = testConfigIdentity(Q.yaml, text);
      location.configIdentities = [identity, testConfigIdentity(Q.auth)];
      location.pnpm!.configIdentities = [...location.configIdentities];
    },
    absent: () => {
      const path = win32.join(Q.config, 'auth.ini');
      location.pnpm!.missingConfigPaths = [path];
      return path;
    },
  };
}

const emptyInventory = (): IGlobalInventoryResult => ({
  packages: [],
  facts: [],
  binOwners: [],
  ownershipComplete: true,
});

async function done(
  service: GlobalPackagesService,
  jobId: string,
): Promise<IGlobalJob> {
  for (let i = 0; i < 1000; i++) {
    const job = service.getJob(jobId);
    if (job.phase === 'done') return job;
    await Promise.resolve();
  }
  throw new Error('TEST job did not finish within mocked microtasks');
}

function setup(change = false) {
  const fixture = testRuntime();
  const facts = testFacts(change);
  let postInventory = emptyInventory();
  const location = jest
    .spyOn(locationAdapter, 'discoverGlobalLocation')
    .mockImplementation((manager) => {
      // Model G2's handle-bound config facts; preserve deliberately tampered hashes.
      facts.location.configIdentities = facts.location.configIdentities.map(
        (identity) => {
          if (!/^[a-f0-9]{64}$/.test(identity.sha256)) return identity;
          const path = identity.file.path;
          const entry = fixture.fs.entries.get(
            win32.resolve(path).toLowerCase(),
          );
          return testConfigIdentity(path, entry?.text ?? '');
        },
      );
      return Promise.resolve(
        manager === 'npm'
          ? { ...testLocation(), ...facts.location }
          : {
              ...testLocation(manager),
              configIdentities: facts.location.configIdentities,
            },
      );
    });
  const inventory = jest
    .spyOn(inventoryAdapter, 'readGlobalInventory')
    .mockImplementation((resolved) =>
      Promise.resolve(
        resolved.manager === 'pnpm'
          ? emptyInventory()
          : fixture.child.launch.mock.calls.length > 0
            ? postInventory
            : testInventory(facts),
      ),
    );
  const versions = jest
    .spyOn(GlobalRegistry.prototype, 'getVersions')
    .mockResolvedValue({
      manager: 'npm',
      package: 'test-tool',
      versions: ['1.0.0', '2.0.0'],
      tags: { latest: '2.0.0' },
    });
  const target = jest
    .spyOn(GlobalRegistry.prototype, 'getTarget')
    .mockResolvedValue(testFacts(true).target!);
  const service = new GlobalPackagesService(fixture.runtime);
  const ready = async (): Promise<IGlobalPreview> => {
    const accepted = await service.preview(
      testRequest(change ? { action: 'change', targetVersion: 'latest' } : {}),
    );
    const job = await done(service, accepted.jobId);
    expect(job.status).toBe('completed');
    expect(job.preview).not.toBeNull();
    return job.preview!;
  };
  const consent = (
    preview: IGlobalPreview,
    patch: Partial<IGlobalExecuteRequest> = {},
  ) =>
    testConsent({
      previewId: preview.previewId,
      confirmText: preview.confirmText,
      ...patch,
    });
  return {
    ...fixture,
    service,
    facts,
    location,
    inventory,
    versions,
    target,
    ready,
    consent,
    post: (value: IGlobalInventoryResult) => {
      postInventory = value;
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pnpm 11 service integration', () => {
  it('isolates a real 1048577-byte pnpm config in npm inventory, preview and execute', async () => {
    const f = setupPnpmService();
    f.fs.put(Q.yaml, { text: 'x'.repeat(1_048_577) });
    f.discover.mockImplementation((manager, deps) =>
      manager === 'npm'
        ? Promise.resolve({ ...testLocation(), ...testFacts().location })
        : readPnpmGlobalConfig({
            fs: f.runtime.fs,
            environment: {
              ...f.runtime.environment,
              USERPROFILE: Q.profile,
              XDG_CONFIG_HOME: 'D:\\TEST\\xdg',
            },
            signal: deps.signal,
            tool: f.location.tool,
            cwd: f.location.cwd,
            checkDirectory: (path) =>
              locationAdapter.assertGlobalDirectory(
                path,
                f.runtime.fs,
                deps.signal,
                true,
              ),
          }).then(() => f.location),
    );
    const inventory = await f.service.inventory({ requestId: f.uuid() });
    expect((await finishPnpmJob(f.service, inventory.jobId)).status).toBe(
      'completed',
    );
    expect(f.service.getSnapshot()!.managers).toEqual([
      expect.objectContaining({ manager: 'npm', available: true }),
      expect.objectContaining({
        manager: 'pnpm',
        available: false,
        reason: 'LIMIT_EXCEEDED',
      }),
    ]);
    const start = await f.service.preview(
      f.request({ manager: 'npm', package: 'test-tool' }),
    );
    const job = await finishPnpmJob(f.service, start.jobId);
    expect(job.status).toBe('completed');
    f.inventory.mockImplementation(() =>
      Promise.resolve(
        f.child.launch.mock.calls.length ? emptyInventory() : testInventory(),
      ),
    );
    const mutation = await f.service.execute(f.consent(job.preview!));
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.child.launch.mock.calls[0][0].args).toContain('uninstall');
    f.child.exit();
    expect(await finishPnpmJob(f.service, mutation.jobId)).toMatchObject({
      status: 'completed',
      gateHeld: false,
    });
  });

  it.each([
    'LIMIT_EXCEEDED',
    'INVENTORY_FAILED',
    'LOCATION_AMBIGUOUS',
    'INTERNAL_SERVER_ERROR',
  ] as const)(
    'isolates pnpm %s from both discovery and inventory without hiding npm',
    async (reason) => {
      const f = setupPnpmService();
      f.unavailable.set('pnpm', reason);
      const discovery = await f.service.inventory({ requestId: f.uuid() });
      expect((await finishPnpmJob(f.service, discovery.jobId)).status).toBe(
        'completed',
      );
      expect(f.service.getSnapshot()!.managers[1]).toMatchObject({
        available: false,
        reason,
      });
      f.unavailable.clear();
      f.inventory.mockImplementation((location) =>
        location.manager === 'pnpm'
          ? Promise.reject(
              new AppException(409, 'TEST pnpm inventory failed', 'CONFLICT', {
                reason,
              }),
            )
          : Promise.resolve(testInventory()),
      );
      const inventory = await f.service.inventory({ requestId: f.uuid() });
      expect((await finishPnpmJob(f.service, inventory.jobId)).status).toBe(
        'completed',
      );
      expect(f.service.getSnapshot()!.managers[0].available).toBe(true);
      expect(f.service.getSnapshot()!.managers[1]).toMatchObject({
        available: false,
        reason,
      });
      f.unavailable.set('pnpm', reason);
      const preview = await f.service.preview(
        f.request({ manager: 'npm', package: 'test-tool' }),
      );
      expect((await finishPnpmJob(f.service, preview.jobId)).status).toBe(
        'completed',
      );
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it('isolates an untyped pnpm IO error with no error text in the snapshot', async () => {
    const f = setupPnpmService();
    f.discover.mockImplementation((manager) =>
      manager === 'pnpm'
        ? Promise.reject(new Error('TEST sensitive config bytes'))
        : Promise.resolve({ ...testLocation(), ...testFacts().location }),
    );
    const start = await f.service.inventory({ requestId: f.uuid() });
    expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
      'completed',
    );
    expect(f.service.getSnapshot()!.managers[1]).toMatchObject({
      reason: 'INTERNAL_SERVER_ERROR',
    });
    expect(JSON.stringify(f.service.getSnapshot())).not.toContain('sensitive');
  });

  it.each([
    'inventory-discovery',
    'inventory-read',
    'secondary-discovery',
  ] as const)(
    'preserves cancellation when a late config failure occurs at %s',
    async (where) => {
      const f = setupPnpmService();
      const pending = deferred<IGlobalResolvedLocation>();
      const reading = deferred<IGlobalInventoryResult>();
      if (where === 'inventory-read')
        f.inventory.mockImplementation((location) =>
          location.manager === 'pnpm'
            ? reading.promise
            : Promise.resolve(testInventory()),
        );
      else
        f.discover.mockImplementation((manager) =>
          manager === 'pnpm'
            ? pending.promise
            : Promise.resolve({ ...testLocation(), ...testFacts().location }),
        );
      const start =
        where === 'secondary-discovery'
          ? await f.service.preview(
              f.request({ manager: 'npm', package: 'test-tool' }),
            )
          : await f.service.inventory({ requestId: f.uuid() });
      await flushJobs();
      await f.service.cancel(start.jobId);
      const error = new AppException(409, 'TEST late cap', 'CONFLICT', {
        reason: 'LIMIT_EXCEEDED',
      });
      if (where === 'inventory-read') reading.reject(error);
      else pending.reject(error);
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'cancelled',
        failureCode: 'CANCELLED',
      });
      expect(f.service.getSnapshot()).toBeNull();
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['discovery', 'inventory'] as const)(
    'does not swallow pnpm termination uncertainty at %s',
    async (where) => {
      const f = setupPnpmService();
      if (where === 'discovery')
        f.unavailable.set('pnpm', 'TERMINATION_UNCONFIRMED');
      else
        f.inventory.mockImplementation((location) =>
          location.manager === 'pnpm'
            ? Promise.reject(
                new AppException(409, 'TEST uncertain stop', 'CONFLICT', {
                  reason: 'TERMINATION_UNCONFIRMED',
                }),
              )
            : Promise.resolve(testInventory()),
        );
      const start = await f.service.inventory({ requestId: f.uuid() });
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'termination_failed',
        failureCode: 'TERMINATION_UNCONFIRMED',
      });
      expect(f.service.getSnapshot()).toBeNull();
    },
  );

  it('rejects secondary pnpm overlap that appears after a ready npm preview', async () => {
    const f = setupPnpmService();
    const start = await f.service.preview(
      f.request({ manager: 'npm', package: 'test-tool' }),
    );
    const ready = await finishPnpmJob(f.service, start.jobId);
    expect(ready.status).toBe('completed');
    f.location.binDir = testLocation().binDir;
    const execute = await f.service.execute(f.consent(ready.preview!));
    expect(await finishPnpmJob(f.service, execute.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
    });
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('lists ready pnpm and npm independently, without pnpm list or mutation', async () => {
    const f = setupPnpmService();
    const start = await f.service.inventory({ requestId: f.uuid() });
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'completed',
    });
    expect(f.service.getSnapshot()!.managers).toEqual([
      expect.objectContaining({ manager: 'npm', available: true }),
      expect.objectContaining({
        manager: 'pnpm',
        available: true,
        reason: null,
        version: '11.22.0',
        globalRoot: Q.root,
        binDir: Q.bin,
        packages: [
          expect.objectContaining({
            name: 'is-number',
            status: 'manageable',
          }) as unknown,
        ],
      }),
    ]);
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
    expect(f.tryEnter).not.toHaveBeenCalled();
  });

  it('accepts a ready bin/PATH with an absent versioned root as empty inventory', async () => {
    const f = setupPnpmService();
    f.location.pnpm!.missingDirectoryPaths = [Q.root];
    f.replaceBefore(emptyPnpmInventory());
    const start = await f.service.inventory({ requestId: f.uuid() });
    expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
      'completed',
    );
    expect(f.service.getSnapshot()!.managers[1]).toMatchObject({
      available: true,
      packages: [],
    });
    expect(f.probe).not.toHaveBeenCalled();
  });

  it('preserves npm inventory if pnpm static inventory is unreadable', async () => {
    const f = setupPnpmService();
    f.inventory.mockImplementation((location) =>
      location.manager === 'pnpm'
        ? Promise.reject(
            new AppException(
              409,
              'TEST unreadable pnpm inventory',
              'CONFLICT',
              { reason: 'INVENTORY_FAILED' },
            ),
          )
        : Promise.resolve(testInventory()),
    );
    const start = await f.service.inventory({ requestId: f.uuid() });
    expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
      'completed',
    );
    expect(f.service.getSnapshot()!.managers).toEqual([
      expect.objectContaining({ manager: 'npm', available: true }),
      expect.objectContaining({
        manager: 'pnpm',
        available: false,
        reason: 'INVENTORY_FAILED',
        packages: [],
      }),
    ]);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it.each([
    'PNPM_GLOBAL_NOT_CONFIGURED',
    'CONFIG_UNSUPPORTED',
    'LOCATION_AMBIGUOUS',
    'TOOL_NOT_FOUND',
    'TOOL_VERSION_MISMATCH',
  ] as const)(
    'surfaces pnpm %s per manager while preserving npm inventory',
    async (reason) => {
      const f = setupPnpmService();
      f.unavailable.set('pnpm', reason);
      const start = await f.service.inventory({ requestId: f.uuid() });
      expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
        'completed',
      );
      expect(f.service.getSnapshot()!.managers).toEqual([
        expect.objectContaining({ manager: 'npm', available: true }),
        {
          manager: 'pnpm',
          version: null,
          available: false,
          reason,
          globalRoot: null,
          binDir: null,
          packages: [],
        },
      ]);
      expect(f.probe).not.toHaveBeenCalled();
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['PNPM_GLOBAL_NOT_CONFIGURED', 'CONFIG_UNSUPPORTED'] as const)(
    'still previews npm when pnpm discovery returns %s',
    async (reason) => {
      const f = setupPnpmService();
      f.unavailable.set('pnpm', reason);
      const start = await f.service.preview(
        f.request({ manager: 'npm', package: 'test-tool' }),
      );
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'completed',
        preview: { manager: 'npm', package: 'test-tool' },
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['versions', 'preview'] as const)(
    'returns setup reason for pnpm %s without fetch or spawn',
    async (kind) => {
      const f = setupPnpmService();
      f.unavailable.set('pnpm', 'PNPM_GLOBAL_NOT_CONFIGURED');
      const request = f.request();
      const start =
        kind === 'versions'
          ? await f.service.versions(request)
          : await f.service.preview(request);
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'PNPM_GLOBAL_NOT_CONFIGURED',
        mutationSpawned: false,
      });
      expect(f.versions).not.toHaveBeenCalled();
      expect(f.target).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['root', 'bin', 'cross'] as const)(
    'never swallows discovered %s overlap as manager unavailability',
    async (kind) => {
      const f = setupPnpmService();
      const npm = testLocation();
      if (kind === 'root') f.location.globalRoot = npm.globalRoot;
      if (kind === 'bin') f.location.binDir = npm.binDir;
      if (kind === 'cross')
        f.location.binDir = win32.join(npm.globalRoot, 'test-bin');
      for (const activity of ['inventory', 'preview'] as const) {
        const start =
          activity === 'inventory'
            ? await f.service.inventory({ requestId: f.uuid() })
            : await f.service.preview(
                f.request({ manager: 'npm', package: 'test-tool' }),
              );
        expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
          status: 'failed',
          failureCode: 'LOCATION_AMBIGUOUS',
        });
      }
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['remove', 'change'] as const)(
    'surfaces readonly group reason for %s before metadata or mutation',
    async (action) => {
      const f = setupPnpmService();
      f.before().packages[0].status = 'invalid';
      f.before().packages[0].reason = 'GLOBAL_GROUP_UNSUPPORTED';
      const start = await f.service.preview(
        f.request({
          action,
          ...(action === 'change' ? { targetVersion: 'latest' } : {}),
        }),
      );
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'GLOBAL_GROUP_UNSUPPORTED',
      });
      expect(f.target).not.toHaveBeenCalled();
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  const blockedPolicies: readonly Partial<IPnpmGlobalPolicy>[] = [
    { defaultRegistry: 'custom' },
    { unknownRouting: true },
    { changeUnsupported: true },
  ];
  it.each(blockedPolicies)(
    'blocks versions/change from pinned pnpm policy %p without metadata calls',
    async (patch) => {
      const f = setupPnpmService(true);
      Object.assign(f.location.pnpm!.policy, patch);
      for (const kind of ['versions', 'preview'] as const) {
        const request = f.request();
        const start =
          kind === 'versions'
            ? await f.service.versions(request)
            : await f.service.preview(request);
        expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
          status: 'failed',
          failureCode: 'REGISTRY_CONFIG_UNSUPPORTED',
        });
      }
      expect(f.versions).not.toHaveBeenCalled();
      expect(f.target).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['@test/tool', false],
    ['@unrelated/tool', true],
  ] as const)(
    'honors matching scope policy for %s (allowed=%s)',
    async (packageName, allowed) => {
      const f = setupPnpmService();
      f.location.pnpm!.policy.scopedRegistries = ['@test'];
      const start = await f.service.versions(
        f.request({ package: packageName }),
      );
      const job = await finishPnpmJob(f.service, start.jobId);
      expect(job.status).toBe(allowed ? 'completed' : 'failed');
      if (!allowed) expect(job.failureCode).toBe('REGISTRY_CONFIG_UNSUPPORTED');
      expect(f.versions).toHaveBeenCalledTimes(allowed ? 1 : 0);
    },
  );

  it('passes only typed pnpm policy summaries to registry lookup, never raw YAML or auth', async () => {
    const f = setupPnpmService();
    const secret = 'TEST-public-auth-value';
    f.fs.put(Q.auth, { text: `//registry.npmjs.org/:_authToken=${secret}\n` });
    f.location.pnpm!.policy.publicAuthPresent = true;
    f.location.configIdentities[1] = testConfigIdentity(
      Q.auth,
      `//registry.npmjs.org/:_authToken=${secret}\n`,
    );
    f.location.pnpm!.configIdentities = [...f.location.configIdentities];
    const start = await f.service.versions(f.request());
    expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
      'completed',
    );
    const input = f.versions.mock.calls[0][0];
    expect(input.pnpmPolicies).toEqual([f.location.pnpm!.policy]);
    expect(input.configs).toEqual([]);
    expect(JSON.stringify(input)).not.toContain(secret);
    expect(JSON.stringify(f.service.getJob(start.jobId))).not.toContain(secret);
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain(secret);
  });

  it('removes offline under custom pnpm routing with exact remove argv and separate home/bin', async () => {
    const f = setupPnpmService();
    f.location.pnpm!.policy.defaultRegistry = 'custom';
    f.config('registry: https://TEST-private.invalid/\n');
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.child.launch.mock.calls[0][0]).toMatchObject({
      args: [
        f.location.tool.entry,
        '--dir',
        f.location.cwd,
        '--pm-on-fail=warn',
        'remove',
        '--global',
        '--global-dir',
        Q.global,
        '--store-dir',
        Q.store,
        '--reporter=append-only',
        '--',
        'is-number',
      ],
      env: { PNPM_HOME: Q.home, pnpm_config_npmrc_auth_file: Q.auth },
      shell: false,
      extendEnv: false,
      stdin: 'ignore',
    });
    expect(f.versions).not.toHaveBeenCalled();
    expect(f.target).not.toHaveBeenCalled();
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'completed',
      auditWritten: true,
      gateHeld: false,
    });
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.audit.mock.calls.map(([record]) => record.phase)).toEqual([
      'intent',
      'result',
    ]);
    expect(f.audit.mock.calls[0][0]).toMatchObject({
      method: 'pnpm:remove',
      targets: [Q.root, 'is-number'],
    });
  });

  it('changes to one pinned exact version with static postinventory', async () => {
    const f = setupPnpmService(true);
    const preview = await f.ready();
    const post = testInventory(f.facts);
    post.packages[0] = { ...post.packages[0], version: '8.0.0' };
    post.facts = [{ ...f.facts.current, version: '8.0.0' }];
    post.pnpmInventory = f.facts.pnpmInventory;
    f.post(post);
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    expect(f.child.launch.mock.calls[0][0].args).toEqual([
      f.location.tool.entry,
      '--dir',
      f.location.cwd,
      '--pm-on-fail=warn',
      'add',
      '--global',
      '--global-dir',
      Q.global,
      '--global-bin-dir',
      Q.bin,
      '--store-dir',
      Q.store,
      '--registry',
      'https://registry.npmjs.org',
      '--reporter=append-only',
      '--',
      'is-number@8.0.0',
    ]);
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'completed',
      mutationSpawned: true,
      gateHeld: false,
    });
    expect(f.probe).not.toHaveBeenCalled();
  });

  it('uses the proven metadata store when config leaves storeDir at its default', async () => {
    const f = setupPnpmService();
    f.location.storeDir = null;
    f.location.pnpm!.storeDir = null;
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    const command = f.child.launch.mock.calls[0][0];
    expect(command.args[command.args.indexOf('--store-dir') + 1]).toBe(Q.store);
    f.child.exit();
    expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
      'completed',
    );
  });

  it.each(
    (['before', 'after-intent'] as const).flatMap((timing) =>
      (['config', 'absence', 'group', 'link', 'shim', 'policy'] as const).map(
        (kind) => ({ timing, kind }),
      ),
    ),
  )('pins $kind facts $timing', async ({ timing, kind }) => {
    const f = setupPnpmService();
    const missing = f.absent();
    const preview = await f.ready();
    const change = () => {
      if (kind === 'config') f.config('minimumReleaseAge: 1440\n');
      if (kind === 'absence') {
        f.fs.put(missing, { text: 'registry=https://registry.npmjs.org/\n' });
        f.location.pnpm!.missingConfigPaths = [];
        f.location.pnpm!.configIdentities = [
          ...f.location.pnpm!.configIdentities,
          testConfigIdentity(missing, 'registry=https://registry.npmjs.org/\n'),
        ];
        f.location.configIdentities = [...f.location.pnpm!.configIdentities];
      }
      if (kind === 'group')
        f.facts.current.pnpmGroup!.lockfile.sha256 += '-changed';
      if (kind === 'link')
        f.facts.current.pnpmGroup!.packageLinks[0].identity.stat.ino = 991;
      if (kind === 'shim')
        f.facts.pnpmInventory!.shimIdentities![0].sha256 += '-changed';
      if (kind === 'policy') f.location.pnpm!.policy.changeUnsupported = true;
    };
    if (timing === 'before') change();
    else
      f.audit.mockImplementationOnce(() => {
        change();
        return Promise.resolve();
      });
    const start = await f.service.execute(f.consent(preview));
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
      mutationSpawned: false,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
    expect(
      f.audit.mock.calls.filter(([record]) => record.phase === 'intent'),
    ).toHaveLength(timing === 'before' ? 0 : 1);
  });

  it.each(['logical', 'store', 'install'] as const)(
    'recomputes pnpm %s protection from private facts',
    async (kind) => {
      const f = setupPnpmService();
      const group = f.facts.current.pnpmGroup!;
      const root =
        kind === 'logical'
          ? group.packageLinks[0].logicalPath
          : kind === 'store'
            ? f.facts.current.packageRoot
            : group.installDir;
      f.location.protectedPaths = [win32.join(root, 'protected-child')];
      const start = await f.service.preview(f.request());
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'PROTECTED_PACKAGE',
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['before', 'after-intent'] as const)(
    'refuses pnpm add orphan cleanup %s, including a fresh orphan',
    async (timing) => {
      const f = setupPnpmService(true);
      if (timing === 'before')
        f.facts.pnpmInventory!.unreferencedDirectories = [
          {
            ...f.facts.current.pnpmGroup!.directory,
            path: win32.join(Q.root, '1-1-0123456789abcdef'),
            stat: {
              ...f.facts.current.pnpmGroup!.directory.stat,
              mtimeMs: f.clock.now().getTime(),
              ctimeMs: f.clock.now().getTime(),
            },
          },
        ];
      if (timing === 'before') {
        const start = await f.service.preview(f.request());
        const job = await finishPnpmJob(f.service, start.jobId);
        expect(job.status).toBe('failed');
        expect(job.preview).toBeNull();
      } else {
        const preview = await f.ready();
        f.audit.mockImplementationOnce(() => {
          f.facts.pnpmInventory!.unreferencedDirectories = [
            {
              ...f.facts.current.pnpmGroup!.directory,
              path: win32.join(Q.root, '1-1-0123456789abcdef'),
              stat: {
                ...f.facts.current.pnpmGroup!.directory.stat,
                mtimeMs: f.clock.now().getTime(),
                ctimeMs: f.clock.now().getTime(),
              },
            },
          ];
          return Promise.resolve();
        });
        const start = await f.service.execute(f.consent(preview));
        expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
          status: 'failed',
          failureCode: 'PREVIEW_CHANGED',
        });
      }
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it('allows remove with an unrelated orphan when all ownership is proven', async () => {
    const f = setupPnpmService();
    f.facts.pnpmInventory!.unreferencedDirectories = [
      {
        ...f.facts.current.pnpmGroup!.directory,
        path: win32.join(Q.root, '1-1-0123456789abcdef'),
        stat: {
          ...f.facts.current.pnpmGroup!.directory.stat,
          mtimeMs: f.clock.now().getTime(),
          ctimeMs: f.clock.now().getTime(),
        },
      },
    ];
    expect((await f.ready()).action).toBe('remove');
  });

  it.each(['remove', 'change'] as const)(
    'refuses unproven inventory ownership for %s',
    async (action) => {
      const f = setupPnpmService(action === 'change');
      f.before().ownershipComplete = false;
      f.facts.pnpmInventory!.ownershipComplete = false;
      const start = await f.service.preview(f.request());
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'BIN_CONFLICT',
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['setup', 'group'] as const)(
    'maps newly lost %s proof at execute to PREVIEW_CHANGED',
    async (kind) => {
      const f = setupPnpmService();
      const preview = await f.ready();
      if (kind === 'setup')
        f.unavailable.set('pnpm', 'PNPM_GLOBAL_NOT_CONFIGURED');
      else {
        f.before().packages[0].status = 'invalid';
        f.before().packages[0].reason = 'GLOBAL_GROUP_UNSUPPORTED';
      }
      const start = await f.service.execute(f.consent(preview));
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'PREVIEW_CHANGED',
        mutationSpawned: false,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it('retains exact consent, shared gate and execute replay for pnpm', async () => {
    const f = setupPnpmService();
    const preview = await f.ready();
    for (const patch of [{ confirmText: 'wrong' }, { acknowledgedRisks: [] }])
      await expect(
        f.service.execute(f.consent(preview, patch)),
      ).rejects.toBeInstanceOf(AppException);
    expect(f.tryEnter).not.toHaveBeenCalled();
    f.tryEnter.mockReturnValueOnce(null);
    await expectGlobalReason(
      () => f.service.execute(f.consent(preview)),
      'RUNNING',
    );
    const request = f.consent(preview);
    const start = await f.service.execute(request);
    expect((await f.service.execute(request)).jobId).toBe(start.jobId);
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    f.child.exit();
    expect((await finishPnpmJob(f.service, start.jobId)).gateHeld).toBe(false);
  });

  it('refuses spawn on intent audit failure', async () => {
    const f = setupPnpmService();
    const preview = await f.ready();
    f.audit.mockRejectedValueOnce(new Error('TEST intent failed'));
    const start = await f.service.execute(f.consent(preview));
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      failureCode: 'AUDIT_WRITE_FAILED',
      mutationSpawned: false,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it.each(['remove', 'change'] as const)(
    'never certifies %s from incomplete static postinventory',
    async (action) => {
      const f = setupPnpmService(action === 'change');
      const preview = await f.ready();
      const post = emptyPnpmInventory();
      post.ownershipComplete = false;
      post.pnpmInventory!.ownershipComplete = false;
      f.post(post);
      const start = await f.service.execute(f.consent(preview));
      await flushJobs();
      f.child.exit();
      const job = await finishPnpmJob(f.service, start.jobId);
      expect(job.status).toBe('failed');
      expect(job.failureCode).toBe('INVENTORY_FAILED');
      expect(job.gateHeld).toBe(true);
      expect(job.refreshRequired).toBe(true);
      expect(f.child.launch).toHaveBeenCalledTimes(1);
      expect(f.probe).not.toHaveBeenCalled();
    },
  );

  it('fails postcondition if the removed name remains in a different pnpm group', async () => {
    const f = setupPnpmService();
    const preview = await f.ready();
    const post = testInventory(f.facts);
    const group = f.facts.current.pnpmGroup!;
    const installDir = win32.join(Q.root, '1234-1a1aa104925-bbbbbbbbbbbbbbbb');
    post.facts = [{ ...f.facts.current, pnpmGroup: { ...group, installDir } }];
    post.pnpmInventory = {
      groups: [post.facts[0].pnpmGroup!],
      ownershipComplete: true,
      unreferencedDirectories: [],
    };
    f.post(post);
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'POSTCONDITION_FAILED',
    });
  });

  it('does not accept duplicate exact rows as one successful change', async () => {
    const f = setupPnpmService(true);
    const preview = await f.ready();
    const post = testInventory(f.facts);
    post.packages = [0, 1].map(() => ({
      ...post.packages[0],
      version: '8.0.0',
    }));
    post.facts = [0, 1].map(() => ({ ...f.facts.current, version: '8.0.0' }));
    post.pnpmInventory = f.facts.pnpmInventory;
    f.post(post);
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'POSTCONDITION_FAILED',
    });
  });

  it('holds gate on result audit failure and retries cleanup without a second mutation', async () => {
    const f = setupPnpmService();
    const preview = await f.ready();
    f.audit.mockImplementation((record) =>
      record.phase === 'result'
        ? Promise.reject(new Error('TEST audit failed'))
        : Promise.resolve(),
    );
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      gateHeld: true,
      failureCode: 'AUDIT_WRITE_FAILED',
    });
    f.audit.mockResolvedValue(undefined);
    await f.service.cancel(start.jobId);
    await flushJobs();
    expect(f.service.getJob(start.jobId).gateHeld).toBe(false);
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });

  it.each(['cancel', 'timeout'] as const)(
    'preserves %s and static cleanup with no pnpm list spawn',
    async (stop) => {
      const f = setupPnpmService();
      f.runtime.timeoutMs = 1000;
      const preview = await f.ready();
      const start = await f.service.execute(f.consent(preview));
      await flushJobs();
      if (stop === 'cancel') await f.service.cancel(start.jobId);
      else f.clock.advance(1000);
      f.child.exit({ exitCode: null, signal: 'SIGTERM' });
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: stop === 'cancel' ? 'cancelled' : 'timed_out',
        mutationSpawned: true,
        gateHeld: false,
      });
      expect(f.child.stop).toHaveBeenCalled();
      expect(f.child.launch).toHaveBeenCalledTimes(1);
      expect(f.probe).not.toHaveBeenCalled();
    },
  );
});

describe('M7 RAM reads and admission', () => {
  it('returns null on a fresh instance; snapshot/latest GET never spawn or fetch', () => {
    const f = setup();
    expect(f.service.getSnapshot()).toBeNull();
    expect(f.service.getLatest()).toBeNull();
    expect(f.location).not.toHaveBeenCalled();
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
    expect(f.tryEnter).not.toHaveBeenCalled();
  });

  it('stores a detached revision/asOf inventory snapshot without taking the mutation gate', async () => {
    const f = setup();
    f.tryEnter.mockReturnValue(null);
    const start = await f.service.inventory({ requestId: TEST_REQUEST_ID });
    expect((await done(f.service, start.jobId)).status).toBe('completed');
    const snapshot = f.service.getSnapshot()!;
    expect(snapshot).toMatchObject({
      stale: false,
      asOf: f.clock.now().toISOString(),
    });
    expect(snapshot.revision).toEqual(expect.any(String));
    expect(snapshot.managers.map((manager) => manager.manager).sort()).toEqual([
      'npm',
      'pnpm',
    ]);
    snapshot.managers.length = 0;
    expect(f.service.getSnapshot()!.managers).toHaveLength(2);
    expect(f.tryEnter).not.toHaveBeenCalled();
    expect(f.audit).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('still previews npm with pnpm enabled and independently discovered', async () => {
    const f = setup();
    const preview = await f.ready();
    expect(preview.manager).toBe('npm');
    expect(
      f.location.mock.calls.filter(([manager]) => manager === 'pnpm'),
    ).toHaveLength(1);
  });
  it.each(['inventory', 'versions', 'preview'] as const)(
    '%s uses the single M7 slot and no gate even when a mutation elsewhere owns it',
    async (kind) => {
      const f = setup();
      f.tryEnter.mockReturnValue(null);
      const wait = deferred<void>();
      f.location.mockImplementationOnce(async () => {
        await wait.promise;
        return { ...testLocation(), ...f.facts.location };
      });
      const input = testRequest();
      const start =
        kind === 'inventory'
          ? await f.service.inventory({ requestId: TEST_REQUEST_ID })
          : kind === 'versions'
            ? await f.service.versions(input)
            : await f.service.preview(input);
      await expectGlobalReason(
        () => f.service.inventory({ requestId: TEST_EXECUTE_ID }),
        'RUNNING',
      );
      expect(f.service.getLatest()).toMatchObject({ jobId: start.jobId, kind });
      expect(f.tryEnter).not.toHaveBeenCalled();
      expect(f.child.launch).not.toHaveBeenCalled();
      wait.resolve();
      await done(f.service, start.jobId);
    },
  );

  it('replays the same request/payload and refuses changed payload before any extra work', async () => {
    const f = setup();
    const input = testRequest();
    const first = await f.service.preview(input);
    const replay = await f.service.preview({ ...input });
    expect(replay.jobId).toBe(first.jobId);
    await expectGlobalReason(
      () => f.service.preview({ ...input, manager: 'pnpm' }),
      'REQUEST_MISMATCH',
    );
    await expectGlobalReason(
      () => f.service.inventory({ requestId: input.requestId }),
      'REQUEST_MISMATCH',
    );
    await done(f.service, first.jobId);
    const afterCompletion = await f.service.preview({ ...input });
    expect(afterCompletion.jobId).toBe(first.jobId);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('does not execute a preview still being computed', async () => {
    const f = setup();
    const wait = deferred<void>();
    f.inventory.mockImplementationOnce(async () => {
      await wait.promise;
      return testInventory(f.facts);
    });
    const start = await f.service.preview(testRequest());
    let rejected = false;
    try {
      await f.service.execute(testConsent({ previewId: start.previewId! }));
    } catch (error) {
      rejected = error instanceof AppException;
    }
    expect(rejected).toBe(true);
    expect(f.child.launch).not.toHaveBeenCalled();
    wait.resolve();
    await done(f.service, start.jobId);
  });

  it('rejects non-Windows explicit activities without probing', async () => {
    const f = testRuntime();
    f.runtime.platform = 'linux';
    const service = new GlobalPackagesService(f.runtime);
    let caught: unknown;
    try {
      await service.inventory({ requestId: TEST_REQUEST_ID });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    expect((caught as AppException).statusCode).toBe(503);
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('reports lost/evicted jobs as NOT_FOUND and never fabricates completion', () => {
    const f = setup();
    expect(() => f.service.getJob('TEST-lost')).toThrow(AppException);
    expect(() => f.service.getLogs('TEST-lost', 0)).toThrow(AppException);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it.each(['versions', 'change'] as const)(
    'refuses private registry %s before lookup or mutation',
    async (kind) => {
      const f = setup(true);
      f.fs.put(f.facts.location.userConfig, {
        text: 'registry=https://TEST-private.invalid/\n',
      });
      const start =
        kind === 'versions'
          ? await f.service.versions(testRequest())
          : await f.service.preview(
              testRequest({ action: 'change', targetVersion: 'latest' }),
            );
      expect((await done(f.service, start.jobId)).failureCode).toBe(
        'REGISTRY_CONFIG_UNSUPPORTED',
      );
      expect(f.versions).not.toHaveBeenCalled();
      expect(f.target).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it('allows offline remove with custom registry and never asks for metadata', async () => {
    const f = setup();
    f.fs.put(f.facts.location.userConfig, {
      text: 'registry=https://TEST-private.invalid/\n',
    });
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    expect(f.target).not.toHaveBeenCalled();
    expect(f.versions).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.child.launch.mock.calls[0][0].args).not.toContain('--registry');
    f.child.exit();
    await done(f.service, start.jobId);
  });

  it('allows public-registry auth key presence without retaining its value in jobs or audits', async () => {
    const f = setup(true);
    f.fs.put(f.facts.location.userConfig, {
      text: '//registry.npmjs.org/:_authToken=TEST-not-a-credential\n',
    });
    const preview = await f.ready();
    expect(f.target).toHaveBeenCalled();
    expect(JSON.stringify(preview)).not.toContain('TEST-not-a-credential');
    expect(JSON.stringify(f.service.getLatest())).not.toContain(
      'TEST-not-a-credential',
    );
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain(
      'TEST-not-a-credential',
    );
  });

  it.each(['protected', 'linked', 'invalid'] as const)(
    'does not make a mutation preview for a %s row',
    async (status) => {
      const f = setup();
      const inventory = testInventory(f.facts);
      inventory.packages[0].status = status;
      inventory.packages[0].reason =
        status === 'protected'
          ? 'PROTECTED_PACKAGE'
          : status === 'linked'
            ? 'LINKED_PACKAGE'
            : 'BIN_CONFLICT';
      f.inventory.mockResolvedValueOnce(inventory);
      const start = await f.service.preview(testRequest());
      expect(await done(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        preview: null,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );
});

describe('M7 execute reservation, replay and preview integrity', () => {
  it('takes gate and reserves one provisional job synchronously before preflight awaits', async () => {
    const f = setup();
    const preview = await f.ready();
    const wait = deferred<void>();
    f.location.mockImplementationOnce(async () => {
      await wait.promise;
      return { ...testLocation(), ...f.facts.location };
    });
    const pending = f.service.execute(f.consent(preview));
    expect(f.tryEnter).toHaveBeenCalledTimes(1);
    const latest = f.service.getLatest()!;
    expect(latest).toMatchObject({
      kind: 'mutation',
      requestId: TEST_EXECUTE_ID,
      previewId: preview.previewId,
      phase: 'preflight',
      gateHeld: true,
    });
    const second = f.service.execute(
      f.consent(preview, { requestId: f.runtime.uuid() }),
    );
    await expectGlobalReason(() => second, 'RUNNING');
    const accepted = await pending;
    expect(accepted.jobId).toBe(latest.jobId);
    expect(f.child.launch).not.toHaveBeenCalled();
    await f.service.cancel(latest.jobId);
    wait.resolve();
    await done(f.service, latest.jobId);
  });

  it('returns 409 with zero mutation if the shared gate is held, without consuming preview', async () => {
    const f = setup();
    const preview = await f.ready();
    f.tryEnter.mockReturnValueOnce(null);
    await expectGlobalReason(
      () => f.service.execute(f.consent(preview)),
      'RUNNING',
    );
    expect(f.child.launch).not.toHaveBeenCalled();
    expect(f.audit).not.toHaveBeenCalled();
    const accepted = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    expect((await done(f.service, accepted.jobId)).status).toBe('completed');
  });

  it('replays an execute after response loss with one job and one launch; altered consent mismatches', async () => {
    const f = setup();
    const preview = await f.ready();
    const input = f.consent(preview);
    const first = await f.service.execute(input);
    const replay = await f.service.execute({ ...input });
    expect(replay.jobId).toBe(first.jobId);
    await expectGlobalReason(
      () => f.service.execute({ ...input, confirmText: 'TEST altered' }),
      'REQUEST_MISMATCH',
    );
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    f.child.exit();
    await done(f.service, first.jobId);
    expect((await f.service.execute(input)).jobId).toBe(first.jobId);
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired ready preview before taking the gate', async () => {
    const f = setup();
    const preview = await f.ready();
    f.clock.advance(300_000);
    await expectGlobalReason(
      () => f.service.execute(f.consent(preview)),
      'PREVIEW_EXPIRED',
    );
    expect(f.tryEnter).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('rechecks TTL after a slow preflight before consuming or auditing intent', async () => {
    const f = setup();
    const preview = await f.ready();
    f.location.mockImplementationOnce(() => {
      f.clock.advance(300_000);
      return Promise.resolve({ ...testLocation(), ...f.facts.location });
    });
    const accepted = await f.service.execute(f.consent(preview));
    expect(await done(f.service, accepted.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_EXPIRED',
      mutationSpawned: false,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
    expect(
      f.audit.mock.calls.filter(([record]) => record.phase === 'intent'),
    ).toEqual([]);
  });

  it('copies accepted consent before an await so callers cannot change acknowledgement or text', async () => {
    const f = setup();
    const preview = await f.ready();
    const wait = deferred<void>();
    f.location.mockImplementationOnce(async () => {
      await wait.promise;
      return { ...testLocation(), ...f.facts.location };
    });
    const input = f.consent(preview);
    const start = await f.service.execute(input);
    input.acknowledgedRisks.length = 0;
    input.confirmText = 'TEST altered after admission';
    wait.resolve();
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    f.child.exit();
    expect((await done(f.service, start.jobId)).status).toBe('completed');
  });

  it.each(['config', 'version', 'manifest', 'ownership', 'location'] as const)(
    'fails the reserved job on changed %s with zero mutation',
    async (changed) => {
      const f = setup();
      const preview = await f.ready();
      if (changed === 'config')
        f.facts.location.configIdentities[0].sha256 += '-changed';
      if (changed === 'version') f.facts.current.version = '1.1.0';
      if (changed === 'manifest') f.facts.current.manifest.sha256 += '-changed';
      if (changed === 'ownership') f.facts.binOwners[0].owner = 'test-other';
      if (changed === 'location') f.facts.location.binDir += '-changed';
      const start = await f.service.execute(f.consent(preview));
      expect(await done(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'PREVIEW_CHANGED',
        mutationSpawned: false,
        gateHeld: false,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
      expect(f.leave).toHaveBeenCalledTimes(1);
    },
  );

  it('re-resolves a tag and rejects moved registry metadata before launch', async () => {
    const f = setup(true);
    const preview = await f.ready();
    f.target.mockResolvedValueOnce({
      ...testFacts(true).target!,
      version: '3.0.0',
    });
    const start = await f.service.execute(f.consent(preview));
    expect((await done(f.service, start.jobId)).failureCode).toBe(
      'PREVIEW_CHANGED',
    );
    expect(f.target).toHaveBeenCalledTimes(2);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it.each([
    { acknowledgedRisks: [] },
    { confirmText: ' REMOVE GLOBAL npm test-tool ' },
    { confirm: false as unknown as true },
  ])(
    'refuses wrong MACHINE_WIDE consent with 400 before the gate: %p',
    async (patch) => {
      const f = setup();
      const preview = await f.ready();
      await expect(
        f.service.execute(f.consent(preview, patch)),
      ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      await flushJobs();
      expect(f.service.getLatest()?.kind).not.toBe('mutation');
      expect(f.child.launch).not.toHaveBeenCalled();
      expect(
        f.audit.mock.calls.filter(([record]) => record.phase === 'intent'),
      ).toEqual([]);
    },
  );

  it('ignores client risk/path/target fields and uses only stored preview facts', async () => {
    const f = setup();
    const preview = await f.ready();
    const payload = {
      ...f.consent(preview),
      risk: { level: 'low', reasons: [] },
      globalRoot: 'D:\\TEST\\attacker',
      targetVersion: '9.9.9',
      package: 'test-other',
    };
    const start = await f.service.execute(payload);
    await flushJobs();
    const command = f.child.launch.mock.calls[0][0];
    expect(command.args.at(-1)).toBe('test-tool');
    expect(command.args).not.toContain('D:\\TEST\\attacker');
    expect(command.args).not.toContain('test-other@9.9.9');
    f.child.exit();
    await done(f.service, start.jobId);
  });
});

describe('M7 audit, final check, postconditions and invalidation', () => {
  it('writes bounded intent/result records with jobId, server targets and high risk', async () => {
    const f = setup();
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    const intent = f.audit.mock.calls.find(
      ([record]) => record.phase === 'intent',
    )![0];
    expect(intent).toMatchObject({
      operation: 'global-packages.remove',
      operationId: start.jobId,
      targets: [preview.globalRoot, 'test-tool'],
      method: 'npm:remove',
      risk: { level: 'high', codes: ['MACHINE_WIDE'] },
    });
    f.child.exit();
    const job = await done(f.service, start.jobId);
    const result = f.audit.mock.calls.find(
      ([record]) => record.phase === 'result',
    )![0];
    expect(result.operationId).toBe(start.jobId);
    expect(JSON.parse(result.result) as unknown).toEqual({
      status: 'completed',
      exitCode: 0,
      signal: null,
      mutationSpawned: true,
      terminationVerified: true,
      mayHaveChanged: true,
      refreshRequired: false,
    });
    expect(Buffer.byteLength(result.result)).toBeLessThan(4096);
    expect(result).not.toHaveProperty('env');
    expect(job).toMatchObject({
      status: 'completed',
      gateHeld: false,
      auditWritten: true,
    });
  });

  it('does not spawn on intent audit failure', async () => {
    const f = setup();
    const preview = await f.ready();
    f.audit.mockRejectedValueOnce(new Error('TEST intent unavailable'));
    const start = await f.service.execute(f.consent(preview));
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'AUDIT_WRITE_FAILED',
      mutationSpawned: false,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('checks facts again after intent, refusing a late change with zero mutation', async () => {
    const f = setup();
    const preview = await f.ready();
    f.audit.mockImplementationOnce(() => {
      f.facts.current.manifest.sha256 += '-late';
      return Promise.resolve();
    });
    const start = await f.service.execute(f.consent(preview));
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
      mutationSpawned: false,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('holds gate throughout postcondition inventory and result audit', async () => {
    const f = setup();
    const preview = await f.ready();
    const post = deferred<IGlobalInventoryResult>();
    const audited = deferred<void>();
    f.inventory.mockImplementation((location) => {
      if (f.child.launch.mock.calls.length > 0) return post.promise;
      return Promise.resolve(
        location.manager === 'npm' ? testInventory(f.facts) : emptyInventory(),
      );
    });
    f.audit.mockImplementation((record) =>
      record.phase === 'result' ? audited.promise : Promise.resolve(),
    );
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    await flushJobs();
    expect(f.busy()).toBe(true);
    expect(f.leave).not.toHaveBeenCalled();
    post.resolve(emptyInventory());
    await flushJobs();
    expect(f.leave).not.toHaveBeenCalled();
    audited.resolve();
    expect((await done(f.service, start.jobId)).gateHeld).toBe(false);
    expect(f.leave).toHaveBeenCalledTimes(1);
  });

  it.each([
    { exitCode: 0, failureCode: null },
    { exitCode: 1, failureCode: 'COMMAND_FAILED' as const },
  ])(
    'stales snapshot and drops all previews on spawned outcome %p',
    async (outcome) => {
      const f = setup();
      const inventory = await f.service.inventory({
        requestId: f.runtime.uuid(),
      });
      await done(f.service, inventory.jobId);
      const preview = await f.ready();
      const start = await f.service.execute(f.consent(preview));
      await flushJobs();
      f.child.exit(outcome);
      const job = await done(f.service, start.jobId);
      expect(f.service.getSnapshot()!.stale).toBe(true);
      expect(job.mayHaveChanged).toBe(true);
      await expectGlobalReason(
        () =>
          f.service.execute(
            f.consent(preview, { requestId: f.runtime.uuid() }),
          ),
        'PREVIEW_CONSUMED',
      );
      expect(f.child.launch).toHaveBeenCalledTimes(1);
    },
  );

  it('leaves a prior inventory snapshot fresh when preflight never spawns', async () => {
    const f = setup();
    const inventory = await f.service.inventory({
      requestId: f.runtime.uuid(),
    });
    await done(f.service, inventory.jobId);
    const preview = await f.ready();
    f.facts.current.version = '1.1.0';
    const start = await f.service.execute(f.consent(preview));
    await done(f.service, start.jobId);
    expect(f.service.getSnapshot()!.stale).toBe(false);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('invalidates other ready previews after any spawned mutation', async () => {
    const f = setup();
    const earlier = await f.ready();
    const second = await f.service.preview(
      testRequest({ requestId: f.runtime.uuid() }),
    );
    const preview = (await done(f.service, second.jobId)).preview!;
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit({ exitCode: 1, failureCode: 'COMMAND_FAILED' });
    await done(f.service, start.jobId);
    let caught: unknown;
    try {
      await f.service.execute(
        f.consent(earlier, { requestId: f.runtime.uuid() }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    expect((caught as AppException).statusCode).toBe(404);
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });

  it('fails POSTCONDITION_FAILED if remove exits zero but the package is still present', async () => {
    const f = setup();
    const preview = await f.ready();
    f.post(testInventory(f.facts));
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'POSTCONDITION_FAILED',
      terminationVerified: true,
    });
  });

  it.each(['version', 'bins'] as const)(
    'requires exact target %s after a change',
    async (part) => {
      const f = setup(true);
      const preview = await f.ready();
      const after = testFacts(true);
      after.current.version = part === 'version' ? '2.0.1' : '2.0.0';
      after.current.bins = part === 'bins' ? [] : after.target!.bins;
      f.post(testInventory(after));
      const start = await f.service.execute(f.consent(preview));
      await flushJobs();
      f.child.exit();
      expect((await done(f.service, start.jobId)).failureCode).toBe(
        'POSTCONDITION_FAILED',
      );
    },
  );

  it('completes a pinned change only with exact version and expected bins', async () => {
    const f = setup(true);
    const preview = await f.ready();
    const after = testFacts(true);
    after.current.version = '2.0.0';
    after.current.bins = after.target!.bins;
    f.post(testInventory(after));
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    expect(f.child.launch.mock.calls[0][0].args.at(-1)).toBe('test-tool@2.0.0');
    f.child.exit();
    expect((await done(f.service, start.jobId)).status).toBe('completed');
    expect(f.audit.mock.calls[0][0].operation).toBe('global-packages.change');
  });

  it('holds gate on post-inventory failure and permits cleanup-only retry', async () => {
    const f = setup();
    const preview = await f.ready();
    f.inventory.mockImplementation((location) =>
      f.child.launch.mock.calls.length > 0
        ? Promise.reject(new Error('TEST inventory unavailable'))
        : Promise.resolve(
            location.manager === 'npm'
              ? testInventory(f.facts)
              : emptyInventory(),
          ),
    );
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    expect(await done(f.service, start.jobId)).toMatchObject({
      gateHeld: true,
      refreshRequired: true,
    });
    f.inventory.mockResolvedValue(emptyInventory());
    await f.service.cancel(start.jobId);
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.service.getJob(start.jobId).gateHeld).toBe(false);
  });

  it('holds gate on result audit failure and retry never executes mutation again', async () => {
    const f = setup();
    const preview = await f.ready();
    f.audit.mockImplementation((record) =>
      record.phase === 'result'
        ? Promise.reject(new Error('TEST result unavailable'))
        : Promise.resolve(),
    );
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit();
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'AUDIT_WRITE_FAILED',
      auditWritten: false,
      gateHeld: true,
    });
    expect(f.leave).not.toHaveBeenCalled();
    f.audit.mockResolvedValue(undefined);
    await f.service.cancel(start.jobId);
    await flushJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.service.getJob(start.jobId).gateHeld).toBe(false);
  });
});

describe('M7 cancellation and shutdown', () => {
  it('retains probe uncertainty when an adapter masks it with an abort; cleanup never reprobes', async () => {
    const f = setup();
    const preview = await f.ready();
    const wait = deferred<IGlobalProbeResult>();
    f.probe.mockReturnValueOnce(wait.promise);
    f.inventory.mockImplementationOnce(async (location, deps) => {
      await deps.spawn(location.tool.file, [location.tool.entry!], {
        cwd: location.cwd,
        env: f.runtime.environment,
        signal: deps.signal,
        timeout: 30_000,
        maxBuffer: { stdout: 1024, stderr: 1024 },
        shell: false,
        extendEnv: false,
        stdin: 'ignore',
        encoding: 'buffer',
        reject: false,
      });
      deps.signal.throwIfAborted();
      return emptyInventory();
    });
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    await f.service.cancel(start.jobId);
    wait.resolve(probeResult({}, { terminationVerified: false }));
    expect(await done(f.service, start.jobId)).toMatchObject({
      terminationVerified: false,
      gateHeld: true,
      mutationSpawned: false,
    });
    f.runtime.verifyProbeTermination = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValue(true);
    await f.service.cancel(start.jobId);
    await flushJobs();
    expect(f.service.getJob(start.jobId).gateHeld).toBe(false);
    expect(f.probe).toHaveBeenCalledTimes(1);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it.each([
    'location',
    'inventory',
    'target',
    'intent',
    'final-check',
  ] as const)(
    'cancels while awaiting %s and never launches afterwards',
    async (boundary) => {
      const f = setup(boundary === 'target');
      const preview = await f.ready();
      const wait = deferred<void>();
      const resolved = { ...testLocation(), ...f.facts.location };
      if (boundary === 'location')
        f.location.mockImplementationOnce(async () => {
          await wait.promise;
          return resolved;
        });
      if (boundary === 'inventory')
        f.inventory.mockImplementationOnce(async () => {
          await wait.promise;
          return testInventory(f.facts);
        });
      if (boundary === 'target')
        f.target.mockImplementationOnce(async () => {
          await wait.promise;
          return f.facts.target!;
        });
      if (boundary === 'intent')
        f.audit.mockImplementationOnce(async () => {
          await wait.promise;
        });
      if (boundary === 'final-check')
        f.audit.mockImplementationOnce(() => {
          f.location.mockImplementationOnce(async () => {
            await wait.promise;
            return resolved;
          });
          return Promise.resolve();
        });
      const start = await f.service.execute(f.consent(preview));
      await flushJobs();
      await f.service.cancel(start.jobId);
      expect(f.service.getJob(start.jobId).stopReason).toBe('cancel');
      wait.resolve();
      expect(await done(f.service, start.jobId)).toMatchObject({
        status: 'cancelled',
        mutationSpawned: false,
        gateHeld: false,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it('stops despite cancel audit failure, holding the gate until audit can be repaired', async () => {
    const f = setup();
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.audit.mockImplementation((record) =>
      record.operation === 'global-packages.cancel'
        ? Promise.reject(new Error('TEST cancel audit unavailable'))
        : Promise.resolve(),
    );
    await f.service.cancel(start.jobId);
    f.child.exit({ exitCode: null, signal: 'SIGTERM' });
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'cancelled',
      gateHeld: true,
    });
    expect(f.child.stop).toHaveBeenCalled();
    f.audit.mockResolvedValue(undefined);
    await f.service.cancel(start.jobId);
    await flushJobs();
    expect(f.service.getJob(start.jobId).gateHeld).toBe(false);
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });

  it('marks timed-out spawned mutation stale and never retries it', async () => {
    const f = setup();
    f.runtime.timeoutMs = 1000;
    const inventory = await f.service.inventory({
      requestId: f.runtime.uuid(),
    });
    await done(f.service, inventory.jobId);
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.clock.advance(1000);
    f.child.exit({ exitCode: null, signal: 'SIGTERM' });
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'timed_out',
      mayHaveChanged: true,
    });
    expect(f.service.getSnapshot()!.stale).toBe(true);
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });

  it('holds gate on uncertain probe stop even though no mutation spawned', async () => {
    const f = setup();
    const preview = await f.ready();
    f.location.mockRejectedValueOnce(
      new AppException(409, 'TEST unknown probe', 'CONFLICT', {
        reason: 'TERMINATION_UNCONFIRMED',
      }),
    );
    const start = await f.service.execute(f.consent(preview));
    expect(await done(f.service, start.jobId)).toMatchObject({
      mutationSpawned: false,
      terminationVerified: false,
      gateHeld: true,
    });
    expect(f.leave).not.toHaveBeenCalled();
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it('does not check postconditions or release gate before uncertain mutation stop is verified', async () => {
    const f = setup();
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    const readsBeforeExit = f.inventory.mock.calls.length;
    f.child.exit({ termination: 'unconfirmed' });
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'termination_failed',
      gateHeld: true,
      terminationVerified: false,
      mutationSpawned: true,
      mayHaveChanged: true,
    });
    expect(f.inventory).toHaveBeenCalledTimes(readsBeforeExit);
    expect(f.leave).not.toHaveBeenCalled();
    await f.service.cancel(start.jobId);
    await flushJobs();
    expect(f.child.stop).toHaveBeenCalled();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.service.getJob(start.jobId)).toMatchObject({
      gateHeld: false,
      terminationVerified: true,
    });
  });

  it('shuts down with M6 stop semantics, then rejects new work', async () => {
    const f = setup();
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    const shutdown = f.service.onModuleDestroy();
    f.child.exit({ exitCode: null, signal: 'SIGTERM' });
    await shutdown;
    expect(f.service.getJob(start.jobId)).toMatchObject({
      stopReason: 'shutdown',
      status: 'cancelled',
    });
    expect(f.child.stop).toHaveBeenCalled();
    await expectGlobalReason(
      () => f.service.inventory({ requestId: f.runtime.uuid() }),
      'SHUTDOWN',
    );
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });

  it('bounds shutdown waiting when a probe does not return', async () => {
    const f = setup();
    const preview = await f.ready();
    const wait = deferred<void>();
    f.location.mockImplementationOnce(async () => {
      await wait.promise;
      return { ...testLocation(), ...f.facts.location };
    });
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    const shutdown = f.service.onModuleDestroy();
    f.clock.advance(30_000);
    await shutdown;
    expect(f.service.getJob(start.jobId).gateHeld).toBe(true);
    expect(f.child.launch).not.toHaveBeenCalled();
    wait.resolve();
    await done(f.service, start.jobId);
  });
});
