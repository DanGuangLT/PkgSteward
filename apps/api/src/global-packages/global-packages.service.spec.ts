import 'reflect-metadata';
import { win32 } from 'node:path';
import { parse, stringify } from 'yaml';
import { AppException } from '@/common/exceptions/app.exception';
import * as locationAdapter from '@/global-packages/discovery/global-location';
import * as inventoryAdapter from '@/global-packages/discovery/global-inventory';
import * as npmOverlayAdapter from '@/global-packages/discovery/npm-overlay';
import { GlobalRegistry } from '@/global-packages/registry/global-registry';
import { GlobalPackagesService } from '@/global-packages/global-packages.service';
import { readPnpmGlobalConfig } from '@/global-packages/config/pnpm-global-config';
import type { IGlobalInventoryResult } from '@/global-packages/discovery/global-inventory';
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
  testProcess,
  testRequest,
  testRuntime,
  TEST_EXECUTE_ID,
  TEST_REQUEST_ID,
} from '@/global-packages/__fixtures__/global-lifecycle';
import {
  expectGlobalReason,
  TEST_NPM_VERSIONS,
  probeResult,
  testLocation,
} from '@/global-packages/__fixtures__/global-adapters';
import { pnpmPreviewFacts } from '@/global-packages/__fixtures__/pnpm11/inventory';
import { npmLifecycleFixture } from '@/global-packages/__fixtures__/npm-overlay/lifecycle';
import { npmTarget } from '@/global-packages/__fixtures__/npm-overlay/facts';
import { PNPM_TEST_PATHS as Q } from '@/global-packages/__fixtures__/pnpm11/facts';
import type { IPnpmGlobalPolicy } from '@/global-packages/interfaces/pnpm-global.types';
import {
  pnpm10BinlessFixture,
  pnpm10InventoryFixture,
  pnpm10PrivateHoistFixture,
} from './__fixtures__/pnpm10/inventory';
import { P10 } from './__fixtures__/pnpm10/config';
import { readPnpm10GlobalInventory } from './discovery/pnpm10-global-inventory';
import { readPnpm10GlobalConfig } from './config/pnpm10-global-config';
import { snapshotGlobalPreviewFacts } from './policy/global-preview';

describe('pnpm 10 shared-project service integration', () => {
  afterEach(() => jest.restoreAllMocks());
  async function finish10(
    service: GlobalPackagesService,
    id: string,
  ): Promise<IGlobalJob> {
    for (let index = 0; index < 100; index++) {
      const job = service.getJob(id);
      if (job.phase === 'done') return job;
      await settleJobs();
    }
    throw new Error('TEST pnpm 10 job did not finish');
  }
  async function setup10(
    action: 'change' | 'remove' = 'remove',
    fixture?: Awaited<ReturnType<typeof pnpm10InventoryFixture>>,
    target = {
      name: action === 'change' ? 'is-number' : 'semver',
      version: '6.0.0',
    },
  ) {
    const f = testRuntime();
    const h =
      fixture ?? (await pnpm10InventoryFixture(action === 'change' ? 4 : 6));
    f.runtime.fs = h.fs;
    f.runtime.environment = h.environment;
    jest.spyOn(f.runtime, 'resolveTool').mockResolvedValue(h.location.tool);
    jest
      .spyOn(locationAdapter, 'discoverGlobalLocation')
      .mockImplementation((manager) =>
        manager === 'pnpm'
          ? Promise.resolve(h.location)
          : Promise.reject(
              new AppException(409, 'TEST absent', 'CONFLICT', {
                reason: 'TOOL_NOT_FOUND',
              }),
            ),
      );
    jest
      .spyOn(inventoryAdapter, 'readGlobalInventory')
      .mockImplementation((location, deps) =>
        readPnpm10GlobalInventory(location, deps),
      );
    jest.spyOn(GlobalRegistry.prototype, 'getTarget').mockResolvedValue({
      name: target.name,
      version: target.version,
      requestedVersion: target.version,
      manifestHash: 'TEST',
      integrity: 'TEST',
      bins: [],
      engines: null,
      deprecated: false,
    });
    const service = new GlobalPackagesService(f.runtime);
    const request = {
      requestId: f.uuid(),
      manager: 'pnpm' as const,
      action,
      package: target.name,
      ...(action === 'change' ? { targetVersion: target.version } : {}),
    };
    const ready = async () => {
      const start = await service.preview(request);
      const job = await finish10(service, start.jobId);
      expect(job).toMatchObject({ status: 'completed', failureCode: null });
      return job.preview!;
    };
    const execute = (preview: IGlobalPreview) =>
      service.execute(
        testConsent({
          requestId: f.uuid(),
          previewId: preview.previewId,
          confirmText: preview.confirmText,
        }),
      );
    return { ...f, h, service, ready, execute };
  }
  type PrivateFixture = Awaited<ReturnType<typeof pnpm10PrivateHoistFixture>>;
  async function waitForLaunch10(
    f: Awaited<ReturnType<typeof setup10>>,
    id: string,
    count = 1,
  ) {
    await f.service.waitForPreflight(id);
    for (let index = 0; index < 100; index++) {
      if (f.child.launch.mock.calls.length === count) return;
      expect(f.service.getJob(id).phase).not.toBe('done');
      await settleJobs();
    }
    throw new Error('TEST pnpm 10 mutation did not launch');
  }
  const privatePath = (relative: string) => win32.join(P10.root, relative);
  const sharedManifest = privatePath(
    '.pnpm/string-width@4.2.3/node_modules/string-width/package.json',
  );
  function replaceEntries(to: PrivateFixture, from: PrivateFixture) {
    to.entries.clear();
    for (const [path, entry] of from.entries) to.entries.set(path, entry);
    to.location.pnpm10 = from.location.pnpm10;
    to.location.configIdentities = [...from.location.configIdentities];
  }
  function driftIdentity(h: PrivateFixture, path: string) {
    const matches = (actual: string) =>
      actual.toLowerCase() === path.toLowerCase();
    const lstat = h.lstat.getMockImplementation()!;
    h.lstat.mockImplementation(async (actual) => {
      const stat = await lstat(actual);
      return matches(actual) ? { ...stat, ino: 99 } : stat;
    });
    const open = h.open.getMockImplementation()!;
    h.open.mockImplementation(async (actual) => {
      const handle = await open(actual);
      return matches(actual)
        ? {
            ...handle,
            stat: async () => ({ ...(await handle.stat()), ino: 99 }),
          }
        : handle;
    });
  }
  it('previews private hoists as ancillary, with only direct shared rows and no bin ownership', async () => {
    const f = await setup10('change', await pnpm10PrivateHoistFixture(true), {
      name: 'wrap-ansi',
      version: '8.0.0',
    });
    const preview = await f.ready();
    expect(preview.sharedPackages).toEqual([
      { name: 'cliui', version: '8.0.1', linked: false },
    ]);
    const result = await readPnpm10GlobalInventory(f.h.location, f.h.deps);
    expect(result.packages.map((p) => p.name).sort()).toEqual([
      'cliui',
      'wrap-ansi',
    ]);
    expect(result.binOwners.filter((b) => b.owner !== null)).toEqual([]);
    expect(f.child.launch).not.toHaveBeenCalled();
  });
  it('keeps private-hoist binless previews supported when configured B is physically absent', async () => {
    const h = await pnpm10PrivateHoistFixture(true);
    const binDir = 'D:\\TEST\\private-hoist-absent-bin';
    Object.assign(h.environment, {
      npm_config_global_bin_dir: binDir,
      PATH: `${binDir};${win32.dirname(h.location.tool.file)}`,
    });
    const config = await readPnpm10GlobalConfig({
      fs: h.fs,
      tool: h.location.tool,
      environment: h.environment,
      cwd: h.location.cwd,
      signal: h.controller.signal,
      checkDirectory: h.checkDirectory,
    });
    h.location.binDir = binDir;
    h.location.pnpm10 = config;
    h.location.configIdentities = [...config.configIdentities];
    const f = await setup10('remove', h, {
      name: 'wrap-ansi',
      version: '7.0.0',
    });
    expect((await f.ready()).sharedPackages).toEqual([
      { name: 'cliui', version: '8.0.1', linked: false },
    ]);
    expect(config.missingDirectoryPaths).toContain(binDir);
    expect(h.entries.has(binDir.toLowerCase())).toBe(false);
    expect(f.child.launch).not.toHaveBeenCalled();
  });
  describe.each(['before-execute', 'after-intent'] as const)(
    'private-hoist drift %s',
    (phase) => {
      it.each([
        'metadata-bytes',
        'wanted-lock-bytes',
        'current-lock-bytes',
        'manifest-bytes',
        'metadata-identity',
        'wanted-lock-identity',
        'current-lock-identity',
        'manifest-identity',
        'link-identity',
        'scope-identity',
        'ancestor-identity',
        'private-directory-identity',
        'target-directory-identity',
        'junction-target',
        'missing-link',
        'extra-link',
        'scope-escape',
        'ancestor-escape',
        'private-directory-escape',
        'target-directory-escape',
        'coherent-new-graph',
      ])('refuses %s with zero launches', async (kind) => {
        const h = await pnpm10PrivateHoistFixture(kind.startsWith('scope'));
        const f = await setup10('remove', h, {
          name: 'wrap-ansi',
          version: '7.0.0',
        });
        const preview = await f.ready();
        const alternate = await pnpm10PrivateHoistFixture(true);
        const files: Record<string, string> = {
          metadata: privatePath('node_modules/.modules.yaml'),
          'wanted-lock': privatePath('pnpm-lock.yaml'),
          'current-lock': privatePath('node_modules/.pnpm/lock.yaml'),
          manifest: sharedManifest,
          link: privatePath('.pnpm/node_modules/string-width'),
          scope: privatePath('.pnpm/node_modules/@test'),
          ancestor: privatePath('.pnpm'),
          'private-directory': privatePath('.pnpm/node_modules'),
          'target-directory': win32.dirname(sharedManifest),
        };
        const drift = () => {
          if (kind.endsWith('-identity'))
            driftIdentity(h, files[kind.replace('-identity', '')]);
          else if (kind.endsWith('-bytes')) {
            const path = files[kind.replace('-bytes', '')];
            const text = h.entries.get(path.toLowerCase())!.text!;
            h.put(path, {
              text:
                kind === 'manifest-bytes'
                  ? JSON.stringify({
                      ...(JSON.parse(text) as object),
                      description: 'TEST private manifest drift',
                    })
                  : `${text}\n`,
            });
          } else if (kind === 'junction-target')
            h.put(files.link, {
              link: true,
              real: privatePath(
                '.pnpm/ansi-regex@5.0.1/node_modules/ansi-regex',
              ),
            });
          else if (kind === 'missing-link')
            h.entries.delete(files.link.toLowerCase());
          else if (kind === 'extra-link')
            h.put(privatePath('.pnpm/node_modules/test-extra'), {
              link: true,
              real: win32.dirname(sharedManifest),
            });
          else if (kind.endsWith('-escape'))
            h.put(files[kind.replace('-escape', '')], {
              link: true,
              real: 'E:\\TEST\\external',
            });
          else replaceEntries(h, alternate);
        };
        if (phase === 'before-execute') drift();
        else
          f.audit.mockImplementation((record) => {
            if (record.phase === 'intent') drift();
            return Promise.resolve();
          });
        // These still-valid layouts must fail because preview facts are pinned,
        // rather than merely because the adapter rejects malformed input.
        if (
          phase === 'before-execute' &&
          (kind.endsWith('-bytes') ||
            kind.endsWith('-identity') ||
            kind === 'coherent-new-graph')
        )
          expect(
            (await readPnpm10GlobalInventory(h.location, h.deps))
              .ownershipComplete,
          ).toBe(true);
        const start = await f.execute(preview);
        expect(await finish10(f.service, start.jobId)).toMatchObject({
          status: 'failed',
          failureCode: 'PREVIEW_CHANGED',
          mutationSpawned: false,
          gateHeld: false,
        });
        expect(
          f.audit.mock.calls.filter(([record]) => record.phase === 'intent'),
        ).toHaveLength(phase === 'after-intent' ? 1 : 0);
        expect(f.child.launch).not.toHaveBeenCalled();
      });
    },
  );
  it('accepts synthetic target-only hoist recomputation across change then remove', async () => {
    const h = await pnpm10PrivateHoistFixture();
    const f = await setup10('change', h, {
      name: 'wrap-ansi',
      version: '8.0.0',
    });
    const original = await readPnpm10GlobalInventory(h.location, h.deps);
    const snapshot = (inventory: IGlobalInventoryResult) =>
      snapshotGlobalPreviewFacts({
        location: h.location,
        current: inventory.facts.find((dep) => dep.name === 'cliui')!,
        target: null,
        binOwners: inventory.binOwners,
        pnpm10Inventory: inventory.pnpm10Inventory!,
      });
    const before = snapshot(original);
    const shared = before.pnpm10Inventory.project.files.find(
      (file) => file.file.path.toLowerCase() === sharedManifest.toLowerCase(),
    )!;
    expect(shared.file.path).toBe(sharedManifest);
    const assertShared = (inventory: IGlobalInventoryResult) => {
      const next = snapshot(inventory);
      expect(next.current).toEqual(before.current);
      expect(
        next.pnpm10Inventory.project.dependencies.find(
          (dep) => dep.name === 'cliui',
        ),
      ).toEqual(
        before.pnpm10Inventory.project.dependencies.find(
          (dep) => dep.name === 'cliui',
        ),
      );
      expect(
        next.pnpm10Inventory.project.files.find(
          (file) =>
            file.file.path.toLowerCase() === sharedManifest.toLowerCase(),
        ),
      ).toEqual(shared);
    };
    const preview = await f.ready();
    const change = await f.execute(preview);
    await waitForLaunch10(f, change.jobId);
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.child.launch.mock.calls[0][0].args.at(-1)).toBe('wrap-ansi@8.0.0');
    replaceEntries(h, await pnpm10PrivateHoistFixture(false, 'change'));
    f.child.exit();
    expect(await finish10(f.service, change.jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      gateHeld: false,
      refreshRequired: false,
    });
    assertShared(await readPnpm10GlobalInventory(h.location, h.deps));
    expect(
      h.entries.has(
        privatePath('.pnpm/node_modules/@test/target-only').toLowerCase(),
      ),
    ).toBe(true);
    const next = await f.service.preview({
      requestId: f.uuid(),
      manager: 'pnpm',
      package: 'wrap-ansi',
      action: 'remove',
    });
    const removePreview = await finish10(f.service, next.jobId);
    expect(removePreview).toMatchObject({ status: 'completed' });
    const removeChild = testProcess();
    f.child.launch.mockImplementationOnce(removeChild.launch);
    const remove = await f.execute(removePreview.preview!);
    await waitForLaunch10(f, remove.jobId, 2);
    expect(f.child.launch).toHaveBeenCalledTimes(2);
    replaceEntries(h, await pnpm10PrivateHoistFixture(false, 'remove'));
    removeChild.exit();
    expect(await finish10(f.service, remove.jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      gateHeld: false,
      refreshRequired: false,
    });
    const after = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(after.packages.map((p) => p.name)).toEqual(['cliui']);
    assertShared(after);
    expect(
      h.entries.has(privatePath('.pnpm/node_modules/wrap-ansi').toLowerCase()),
    ).toBe(true);
    expect(
      h.entries.has(
        privatePath('.pnpm/node_modules/@test/target-only').toLowerCase(),
      ),
    ).toBe(false);
  });
  it.each(['layout', 'manifest', 'link', 'neighbour'] as const)(
    'fails synthetic after-state %s without retry or rollback',
    async (kind) => {
      const h = await pnpm10PrivateHoistFixture();
      const f = await setup10('change', h, {
        name: 'wrap-ansi',
        version: '8.0.0',
      });
      const start = await f.execute(await f.ready());
      await waitForLaunch10(f, start.jobId);
      replaceEntries(h, await pnpm10PrivateHoistFixture(false, 'change'));
      if (kind === 'layout')
        h.put(privatePath('.pnpm/node_modules/test-extra'), {
          link: true,
          real: win32.dirname(sharedManifest),
        });
      if (kind === 'manifest')
        h.put(sharedManifest, {
          text: JSON.stringify({ name: 'string-width', version: '9.0.0' }),
        });
      if (kind === 'link')
        h.put(privatePath('.pnpm/node_modules/string-width'), {
          link: true,
          real: 'E:\\TEST\\external',
        });
      if (kind === 'neighbour') {
        h.put(privatePath('package.json'), {
          text: JSON.stringify({
            dependencies: { cliui: '^8.0.1', 'wrap-ansi': '8.0.0' },
          }),
        });
        for (const relative of [
          'pnpm-lock.yaml',
          'node_modules/.pnpm/lock.yaml',
        ]) {
          const path = privatePath(relative);
          const lock = parse(h.entries.get(path.toLowerCase())!.text!) as {
            importers: Record<
              string,
              { dependencies: Record<string, { specifier: string }> }
            >;
          };
          lock.importers['.'].dependencies.cliui.specifier = '^8.0.1';
          h.put(path, { text: stringify(lock) });
        }
      }
      f.child.exit();
      expect(await finish10(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'POSTCONDITION_FAILED',
        mutationSpawned: true,
        refreshRequired: true,
        gateHeld: kind !== 'neighbour',
      });
      expect(f.child.launch).toHaveBeenCalledTimes(1);
      expect(f.busy()).toBe(kind !== 'neighbour');
    },
  );
  it('completes binless change after separate bin cleanup, then removes the final package', async () => {
    const f = await setup10(
      'change',
      await pnpm10BinlessFixture('7.0.0', false),
    );
    const preview = await f.ready(),
      start = await f.execute(preview);
    await f.service.waitForPreflight(start.jobId);
    await settleJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    const after = await pnpm10BinlessFixture('6.0.0');
    f.h.entries.clear();
    for (const [p, entry] of after.entries) f.h.entries.set(p, entry);
    f.child.exit();
    expect(await finish10(f.service, start.jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      gateHeld: false,
      refreshRequired: false,
    });
    f.h.location.pnpm10 = after.location.pnpm10;
    f.h.location.configIdentities = [...after.location.configIdentities];
    const next = await f.service.preview({
      requestId: f.uuid(),
      manager: 'pnpm',
      package: 'is-number',
      action: 'remove',
    });
    const remove = await finish10(f.service, next.jobId);
    expect(remove).toMatchObject({ status: 'completed', failureCode: null });
    const removeChild = testProcess();
    f.child.launch.mockImplementationOnce(removeChild.launch);
    const removal = await f.execute(remove.preview!);
    await f.service.waitForPreflight(removal.jobId);
    await settleJobs();
    expect(f.child.launch).toHaveBeenCalledTimes(2);
    const empty = await pnpm10BinlessFixture(null);
    f.h.entries.clear();
    for (const [p, entry] of empty.entries) f.h.entries.set(p, entry);
    removeChild.exit();
    expect(await finish10(f.service, removal.jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      gateHeld: false,
      refreshRequired: false,
    });
  });
  it('refuses a binful target when the configured bin directory is absent', async () => {
    const f = await setup10('change', await pnpm10BinlessFixture());
    jest.spyOn(GlobalRegistry.prototype, 'getTarget').mockResolvedValue({
      name: 'is-number',
      version: '6.0.0',
      requestedVersion: '6.0.0',
      manifestHash: 'TEST',
      integrity: 'TEST',
      bins: [{ name: 'is-number', target: 'bin.js' }],
      engines: null,
      deprecated: false,
    });
    const start = await f.service.preview({
      requestId: f.uuid(),
      manager: 'pnpm',
      action: 'change',
      package: 'is-number',
      targetVersion: '6.0.0',
    });
    expect(await finish10(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PNPM_GLOBAL_NOT_CONFIGURED',
      preview: null,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
  });
  it.each(['before-execute', 'after-intent'] as const)(
    'refuses absent bin appearance %s without launching',
    async (phase) => {
      const f = await setup10('change', await pnpm10BinlessFixture());
      const preview = await f.ready();
      const appear = () => f.h.put(f.h.location.binDir, { directory: true });
      if (phase === 'before-execute') appear();
      else
        f.audit.mockImplementation((record) => {
          if (record.phase === 'intent') appear();
          return Promise.resolve();
        });
      const start = await f.execute(preview);
      expect(await finish10(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'PREVIEW_CHANGED',
        mutationSpawned: false,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );
  it.each(['valid', 'missing-root', 'binful', 'linked'] as const)(
    'requires absent-bin inventory proof for versions: %s',
    async (kind) => {
      const h =
        kind === 'binful' || kind === 'linked'
          ? await pnpm10InventoryFixture(kind === 'binful' ? 1 : 6)
          : await pnpm10BinlessFixture();
      if (kind === 'binful' || kind === 'linked') {
        h.location.binDir = 'D:\\TEST\\absent-bin';
        h.location.pnpm10 = {
          ...h.location.pnpm10,
          binDir: h.location.binDir,
          missingDirectoryPaths: [h.location.binDir],
        };
      }
      if (kind === 'missing-root') {
        const root = h.location.globalRoot.toLowerCase();
        for (const p of h.entries.keys())
          if (p === root || p.startsWith(`${root}\\`)) h.entries.delete(p);
      }
      h.environment.npm_config_global_bin_dir = h.location.binDir;
      h.environment.PATH = `${h.location.binDir};${win32.dirname(h.location.tool.file)}`;
      const config = await readPnpm10GlobalConfig({
        fs: h.fs,
        tool: h.location.tool,
        environment: h.environment,
        cwd: h.location.cwd,
        signal: h.controller.signal,
        checkDirectory: h.checkDirectory,
      });
      h.location.pnpm10 = config;
      h.location.configIdentities = [...config.configIdentities];
      const f = await setup10('change', h);
      const lookup = jest
        .spyOn(GlobalRegistry.prototype, 'getVersions')
        .mockResolvedValue({
          manager: 'pnpm',
          package: 'is-number',
          versions: ['6.0.0', '7.0.0'],
          tags: { latest: '7.0.0' },
          deprecatedVersions: [],
        });
      const start = await f.service.versions({
        requestId: f.uuid(),
        manager: 'pnpm',
        package: 'is-number',
      });
      const job = await finish10(f.service, start.jobId);
      if (kind === 'valid') {
        expect(job).toMatchObject({ status: 'completed', failureCode: null });
        expect(lookup).toHaveBeenCalledTimes(1);
      } else {
        expect(job).toMatchObject({
          status: 'failed',
          failureCode: 'PNPM_GLOBAL_NOT_CONFIGURED',
        });
        expect(lookup).not.toHaveBeenCalled();
      }
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );
  it('previews linked neighbours and refuses post-intent neighbour drift with zero launch', async () => {
    const f = await setup10();
    const preview = await f.ready();
    expect(preview.sharedPackages?.some((d) => d.linked)).toBe(true);
    f.audit.mockImplementation((record) => {
      if (record.phase === 'intent')
        f.h.put(`${f.h.location.binDir}\\foreign.txt`, { text: 'TEST drift' });
      return Promise.resolve();
    });
    const start = await f.execute(preview);
    expect(await finish10(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
      mutationSpawned: false,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
  });
  it.each(['change', 'remove'] as const)(
    'executes %s once and verifies static shared-project state',
    async (action) => {
      const f = await setup10(action),
        preview = await f.ready();
      const start = await f.execute(preview);
      await f.service.waitForPreflight(start.jobId);
      await settleJobs();
      expect(f.child.launch).toHaveBeenCalledTimes(1);
      const after = await pnpm10InventoryFixture(action === 'change' ? 5 : 7);
      f.h.entries.clear();
      for (const [path, entry] of after.entries) f.h.entries.set(path, entry);
      f.child.exit();
      expect(await finish10(f.service, start.jobId)).toMatchObject({
        status: 'completed',
        gateHeld: false,
        refreshRequired: false,
      });
      expect(f.probe).not.toHaveBeenCalled();
    },
  );
  it('reports postcondition drift with refresh required and no relaunch', async () => {
    const f = await setup10('change'),
      preview = await f.ready();
    const start = await f.execute(preview);
    await f.service.waitForPreflight(start.jobId);
    await settleJobs();
    f.child.exit();
    expect(await finish10(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'POSTCONDITION_FAILED',
      refreshRequired: true,
    });
    expect(f.child.launch).toHaveBeenCalledTimes(1);
  });
  it.each(['failure', 'cancel', 'timeout', 'uncertain'] as const)(
    'retains partial-state handling after %s',
    async (kind) => {
      const f = await setup10();
      if (kind === 'timeout') f.runtime.timeoutMs = 1000;
      const preview = await f.ready();
      if (kind === 'uncertain') f.child.stop.mockResolvedValue('unconfirmed');
      const start = await f.execute(preview);
      await f.service.waitForPreflight(start.jobId);
      await settleJobs();
      expect(f.child.launch).toHaveBeenCalledTimes(1);
      if (kind === 'failure')
        f.child.exit({ exitCode: 1, failureCode: 'COMMAND_FAILED' });
      else if (kind === 'timeout') {
        f.clock.advance(1000);
        f.child.exit();
      } else {
        const pending = f.service.cancel(start.jobId);
        f.child.exit({
          termination: kind === 'uncertain' ? 'unconfirmed' : 'verified',
        });
        await pending;
      }
      expect(await finish10(f.service, start.jobId)).toMatchObject({
        status:
          kind === 'failure'
            ? 'failed'
            : kind === 'timeout'
              ? 'timed_out'
              : kind === 'uncertain'
                ? 'termination_failed'
                : 'cancelled',
        mutationSpawned: true,
        mayHaveChanged: true,
      });
      expect(f.child.launch).toHaveBeenCalledTimes(1);
      if (kind === 'uncertain') expect(f.busy()).toBe(true);
    },
  );
});

// npm-self reads ~40 exact paths statically per check; a fixed microtask budget is not enough.
// Mocks resolve as microtasks and the clock is fake, so one macrotask turn settles the chain.
const settleJobs = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('npm-self service integration (static facts, mocked IO)', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup(state: 'absent' | 'present' | 'broken' = 'absent') {
    const f = npmLifecycleFixture(state);
    jest
      .spyOn(locationAdapter, 'discoverGlobalLocation')
      .mockImplementation((manager) =>
        manager !== 'npm'
          ? Promise.reject(
              new AppException(409, 'TEST unavailable', 'CONFLICT', {
                reason: 'TOOL_NOT_FOUND',
              }),
            )
          : Promise.resolve(f.location),
      );
    const inventory = jest
      .spyOn(inventoryAdapter, 'readGlobalInventory')
      .mockRejectedValue(
        new AppException(409, 'TEST npm ls fails', 'CONFLICT', {
          reason: 'INVENTORY_FAILED',
        }),
      );
    const target = jest
      .spyOn(GlobalRegistry.prototype, 'getTarget')
      .mockResolvedValue(npmTarget());
    const service = new GlobalPackagesService(f.runtime);
    const request = (action: IGlobalPreviewRequest['action']) => ({
      requestId: f.uuid(),
      manager: 'npm' as const,
      package: 'npm',
      action,
      ...(action === 'change' ? { targetVersion: 'latest' } : {}),
    });
    const ready = async (action: IGlobalPreviewRequest['action']) => {
      const start = await service.preview(request(action));
      const job = await finishPnpmJob(service, start.jobId);
      expect(job).toMatchObject({ status: 'completed', failureCode: null });
      return job.preview!;
    };
    const execute = (preview: IGlobalPreview) =>
      service.execute(
        testConsent({
          requestId: f.uuid(),
          previewId: preview.previewId,
          confirmText: preview.confirmText,
        }),
      );
    return { ...f, service, inventory, target, request, ready, execute };
  }

  it.each(['change', 'remove'] as const)(
    'executes %s through bundled npm and checks static postconditions',
    async (action) => {
      const f = setup(action === 'change' ? 'absent' : 'present');
      f.location.tool.identities = [
        {
          path: f.location.tool.packageDir,
          stat: await f.runtime.fs.lstat(f.location.tool.packageDir),
        },
      ];
      if (action === 'remove') f.present('11.17.0'); // Equal to bundled is still restorable.
      const preview = await f.ready(action);
      expect(preview.npm).toMatchObject({
        appVersion: '11.17.0',
        terminalBefore: '11.17.0',
      });
      const start = await f.execute(preview);
      await f.service.waitForPreflight(start.jobId);
      await settleJobs();
      expect(f.child.launch).toHaveBeenCalledTimes(1);
      expect(f.child.launch.mock.calls[0][0].args).toEqual(
        expect.arrayContaining([
          action === 'change' ? 'install' : 'uninstall',
          '--global',
          '--',
          action === 'change' ? 'npm@12.2.2' : 'npm',
        ]),
      );
      if (action === 'change') f.present();
      else f.absent();
      f.child.exit();
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'completed',
        gateHeld: false,
        refreshRequired: false,
        npmRepair: null,
      });
      expect(f.inventory).not.toHaveBeenCalled();
    },
  );

  it('repairs broken npm without launch, updates progress and audits exact targets', async () => {
    const f = setup('broken');
    const preview = await f.ready('repair');
    const start = await f.execute(preview);
    const job = await finishPnpmJob(f.service, start.jobId);
    expect(job).toMatchObject({
      status: 'completed',
      mutationSpawned: false,
      mayHaveChanged: true,
      exitCode: null,
      terminationVerified: true,
      gateHeld: false,
      npmRepair: {
        deleted: preview.npm!.repairTargets,
        failed: null,
        remaining: [],
      },
    });
    expect(f.rm.mock.calls.map(([path]) => path)).toEqual(
      preview.npm!.repairTargets,
    );
    expect(
      f.rm.mock.calls.every(
        ([, options]) =>
          options.maxRetries === 0 &&
          options.force === false &&
          options.recursive,
      ),
    ).toBe(true);
    expect(f.audit.mock.calls.map(([record]) => record.targets)).toEqual([
      preview.npm!.repairTargets,
      preview.npm!.repairTargets,
    ]);
    expect(f.child.launch).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn mock, never called with this
    expect(f.runtime.resolveTool).not.toHaveBeenCalled();
    expect(f.inventory).not.toHaveBeenCalled();
  });

  const attachNpm10Compat = async (
    f: ReturnType<typeof setup>,
  ): Promise<{
    preload: string;
    source: string;
    loader: string;
    libDir: string;
  }> => {
    const preload = win32.join(
      f.memory.nodeDir,
      'app',
      'npm10-install-preload.js',
    );
    const libDir = win32.join(f.location.tool.packageDir, 'lib');
    const commandsDir = win32.join(libDir, 'commands');
    const source = win32.join(commandsDir, 'install.js');
    const loader = win32.join(libDir, 'npm.js');
    f.memory.put(preload, { text: 'TEST preload' });
    f.memory.put(source, { text: 'TEST install' });
    f.memory.put(loader, { text: 'TEST loader' });
    f.runtime.nodeVersion = '22.23.5';
    f.location.tool.version = '10.9.9';
    f.location.tool.identities = [
      {
        path: f.location.tool.packageDir,
        stat: await f.runtime.fs.lstat(f.location.tool.packageDir),
      },
    ];
    f.location.tool.npm10InstallCompat = {
      revision: 1,
      supported: true,
      preload,
      source,
      loader,
      sourceSha256: 'a'.repeat(64),
      loaderSha256: 'b'.repeat(64),
      preloadSha256: 'c'.repeat(64),
    };
    f.location.tool.npm10InstallCompatIdentities = await Promise.all(
      [
        win32.dirname(preload),
        f.location.tool.packageDir,
        libDir,
        commandsDir,
        preload,
        source,
        loader,
      ].map(async (path) => ({
        path,
        stat: await f.runtime.fs.lstat(path),
      })),
    );
    return { preload, source, loader, libDir };
  };

  it.each(['change', 'remove', 'repair'] as const)(
    'revalidates snapshotted npm 10 install-compat files and parent directories during %s postcondition',
    async (action) => {
      const f = setup(
        action === 'change'
          ? 'absent'
          : action === 'remove'
            ? 'present'
            : 'broken',
      );
      await attachNpm10Compat(f);
      if (action === 'change') {
        f.target.mockResolvedValue(
          npmTarget({ version: '11.17.0', engines: '^20.17.0 || >=22.9.0' }),
        );
      }
      const preview = await f.ready(action);
      const start = await f.execute(preview);
      if (action === 'repair') {
        expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
          status: 'completed',
          failureCode: null,
          gateHeld: false,
          refreshRequired: false,
        });
        return;
      }
      await f.service.waitForPreflight(start.jobId);
      await settleJobs();
      if (action === 'change') f.present('11.17.0');
      else f.absent();
      f.child.exit();
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'completed',
        failureCode: null,
        gateHeld: false,
        refreshRequired: false,
      });
    },
  );

  it.each(['file', 'directory'] as const)(
    'fails npm-self postcondition when a snapshotted npm 10 install-compat %s drifts',
    async (kind) => {
      const f = setup('absent');
      const compat = await attachNpm10Compat(f);
      f.target.mockResolvedValue(
        npmTarget({ version: '11.17.0', engines: '^20.17.0 || >=22.9.0' }),
      );
      const preview = await f.ready('change');
      const start = await f.execute(preview);
      await f.service.waitForPreflight(start.jobId);
      await settleJobs();
      f.present('11.17.0');
      if (kind === 'file') {
        f.memory.put(compat.source, { text: 'TEST drifted install source' });
      } else {
        f.memory.put(compat.libDir, { directory: true, link: true });
      }
      f.child.exit();
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'POSTCONDITION_FAILED',
        gateHeld: false,
      });
    },
  );

  it('deletes the overlay before exact retired artifacts and ignores directory timestamp drift', async () => {
    const f = setup('broken');
    const retired = win32.join(f.location.globalRoot, '.npm-p9Z75ZzS');
    f.memory.put(retired, { directory: true });
    const preview = await f.ready('repair');
    expect(preview.npm!.repairTargets.slice(-2)).toEqual([
      f.memory.overlay,
      retired,
    ]);
    const lstat = f.memory.lstat.getMockImplementation()!;
    f.memory.lstat.mockImplementation(async (path) => {
      const stat = await lstat(path);
      return path === f.memory.overlay && f.rm.mock.calls.length > 0
        ? { ...stat, mtimeMs: 50, ctimeMs: 60, size: 100 }
        : stat;
    });
    const start = await f.execute(preview);
    await settleJobs();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'completed',
      npmRepair: {
        deleted: preview.npm!.repairTargets,
        remaining: [],
        failed: null,
      },
    });
  });

  it('pins directory dev/ino immediately before rm', async () => {
    const f = setup('broken');
    const preview = await f.ready('repair');
    const lstat = f.memory.lstat.getMockImplementation()!;
    f.memory.lstat.mockImplementation(async (path) => {
      const stat = await lstat(path);
      return path === f.memory.overlay && f.rm.mock.calls.length > 0
        ? { ...stat, ino: 77 }
        : stat;
    });
    const start = await f.execute(preview);
    await settleJobs();
    const job = await finishPnpmJob(f.service, start.jobId);
    expect(job).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
      npmRepair: {
        failed: { path: f.memory.overlay, code: 'PREVIEW_CHANGED' },
        remaining: [f.memory.overlay],
      },
    });
    expect(f.rm).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['absent', 'remove', 'NPM_OVERLAY_ABSENT'],
    ['absent', 'repair', 'NPM_OVERLAY_NOT_BROKEN'],
    ['present', 'repair', 'NPM_OVERLAY_NOT_BROKEN'],
  ] as const)('refuses %s / %s', async (state, action, failureCode) => {
    const f = setup(state);
    const start = await f.service.preview(f.request(action));
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode,
    });
  });

  it.each(['linked', 'unsupported', 'delegation', 'engine', 'target'] as const)(
    'refuses unsafe %s change',
    async (variant) => {
      const f = setup(variant === 'linked' ? 'present' : 'absent');
      const failureCode = {
        linked: 'LINKED_PACKAGE',
        unsupported: 'NPM_PREFIX_IS_NODE_DIR',
        delegation: 'NPM_DELEGATION_UNVERIFIED',
        engine: 'ENGINE_UNSUPPORTED',
        target: 'TARGET_VERSION_UNSUPPORTED',
      }[variant];
      if (variant === 'linked')
        f.memory.put(f.memory.overlay, { directory: true, link: true });
      if (variant === 'unsupported') {
        f.location.prefix = f.memory.nodeDir;
        f.location.binDir = f.memory.nodeDir;
        f.location.globalRoot = win32.join(f.memory.nodeDir, 'node_modules');
      }
      if (variant === 'delegation')
        f.memory.put(win32.join(f.memory.nodeDir, 'npm.cmd'), {
          text: 'TEST foreign',
        });
      if (variant === 'engine') f.runtime.nodeVersion = '24.0.0';
      if (variant === 'target')
        f.target.mockResolvedValue(npmTarget({ version: '9.9.4' }));
      const start = await f.service.preview(f.request('change'));
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it('rejects pnpm/npm mutation before discovery with HTTP 403', async () => {
    const f = setup();
    await expect(
      f.service.preview({ ...f.request('remove'), manager: 'pnpm' }),
    ).rejects.toMatchObject({
      statusCode: 403,
      details: { reason: 'PROTECTED_PACKAGE' },
    });
    expect(locationAdapter.discoverGlobalLocation).not.toHaveBeenCalled();
  });

  it.each(['preflight', 'final'] as const)(
    'maps changed npm facts at %s boundary to PREVIEW_CHANGED',
    async (boundary) => {
      const f = setup('present');
      const preview = await f.ready('remove');
      if (boundary === 'preflight') f.absent();
      else
        f.audit.mockImplementation((record) => {
          if (record.phase === 'intent') f.absent();
          return Promise.resolve();
        });
      const start = await f.execute(preview);
      if (boundary === 'preflight')
        await expect(
          f.service.waitForPreflight(start.jobId),
        ).rejects.toMatchObject({ details: { reason: 'PREVIEW_CHANGED' } });
      expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'PREVIEW_CHANGED',
        gateHeld: false,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['busy', 'cancel', 'identity', 'gone', 'parent'] as const)(
    'stops repair between targets on %s',
    async (variant) => {
      const f = setup('broken');
      const preview = await f.ready('repair');
      const paths = preview.npm!.repairTargets;
      f.rm.mockImplementation(async (path) => {
        if (variant === 'busy' && path === paths[1])
          throw Object.assign(new Error('TEST busy'), { code: 'EBUSY' });
        f.removeTree(path);
        if (path === paths[0]) {
          if (variant === 'cancel')
            await f.service.cancel(f.service.getLatest()!.jobId);
          if (variant === 'identity')
            f.memory.put(paths[1], { text: 'TEST changed' });
          if (variant === 'gone') f.memory.remove(paths[1]);
          if (variant === 'parent')
            f.memory.put(f.location.globalRoot, {
              directory: true,
              link: true,
            });
        }
      });
      const start = await f.execute(preview);
      const job = await finishPnpmJob(f.service, start.jobId);
      expect(job).toMatchObject({
        status: variant === 'cancel' ? 'cancelled' : 'failed',
        failureCode:
          variant === 'busy'
            ? 'FILE_IN_USE'
            : variant === 'cancel'
              ? 'CANCELLED'
              : 'PREVIEW_CHANGED',
        mayHaveChanged: true,
        mutationSpawned: false,
      });
      expect(job.npmRepair?.deleted).toEqual([paths[0]]);
      expect(job.npmRepair?.remaining).toEqual(paths.slice(1));
      if (variant !== 'cancel')
        expect(job.npmRepair?.failed).toEqual({
          path: paths[1],
          code: variant === 'busy' ? 'FILE_IN_USE' : 'PREVIEW_CHANGED',
        });
      expect(f.rm).toHaveBeenCalledTimes(variant === 'busy' ? 2 : 1);
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

  it.each(['unmet', 'unreadable', 'node-shim', 'bundled'] as const)(
    'handles %s postcondition and gate ownership',
    async (variant) => {
      const f = setup('present');
      f.location.tool.identities = [
        {
          path: f.location.tool.file,
          stat: await f.runtime.fs.lstat(f.location.tool.file),
        },
      ];
      const preview = await f.ready('remove');
      const start = await f.execute(preview);
      await f.service.waitForPreflight(start.jobId);
      await settleJobs();
      if (variant === 'unreadable') f.memory.remove(f.location.globalRoot);
      if (variant === 'node-shim') {
        f.absent();
        f.memory.put(win32.join(f.memory.nodeDir, 'npm.cmd'), {
          text: 'TEST replaced',
        });
      }
      if (variant === 'bundled') {
        f.absent();
        f.memory.put(f.location.tool.file, {
          text: 'TEST replaced node executable',
        });
      }
      f.child.exit();
      const job = await finishPnpmJob(f.service, start.jobId);
      expect(job).toMatchObject({
        status: 'failed',
        failureCode:
          variant === 'unreadable'
            ? 'INVENTORY_FAILED'
            : 'POSTCONDITION_FAILED',
        refreshRequired: variant === 'unreadable',
        gateHeld: variant === 'unreadable',
      });
      if (variant === 'unreadable') {
        f.memory.put(f.location.globalRoot, { directory: true });
        f.absent();
        await f.service.cancel(start.jobId);
        expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
          refreshRequired: false,
          gateHeld: false,
        });
        expect(f.child.launch).toHaveBeenCalledTimes(1);
      }
      expect(f.inventory).not.toHaveBeenCalled();
    },
  );

  it('restores with an unchanged linked Node-dir shim (unverified delegation) (G3-1)', async () => {
    const f = setup('present');
    // A reparse Node-dir shim makes delegation unverified: change is refused, restore stays allowed.
    f.memory.put(win32.join(f.memory.nodeDir, 'npm.ps1'), {
      link: true,
      real: win32.join(f.memory.nodeDir, 'npm.ps1'),
    });
    const preview = await f.ready('remove');
    const start = await f.execute(preview);
    await f.service.waitForPreflight(start.jobId);
    await settleJobs();
    f.absent();
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'completed',
      failureCode: null,
      gateHeld: false,
    });
  });

  it('refuses to delete a retired artifact whose on-disk name changed case (G3-2)', async () => {
    const f = setup('absent');
    const retired = 'D:\\TEST\\prefix\\node_modules\\.npm-p9Z75ZzS';
    f.memory.put(retired, { directory: true });
    const preview = await f.ready('repair');
    expect(preview.npm!.repairTargets).toEqual([retired]);
    f.memory.put(retired, {
      directory: true,
      real: 'D:\\TEST\\prefix\\node_modules\\.npm-P9Z75ZZS',
    });
    const start = await f.execute(preview);
    await settleJobs();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
    });
    expect(f.rm).not.toHaveBeenCalled();
  });

  it('refuses a same-size shim edit by digest before rm (G3-3)', async () => {
    const f = setup('broken');
    const preview = await f.ready('repair');
    const paths = preview.npm!.repairTargets;
    f.rm.mockImplementation((path) => {
      f.removeTree(path);
      if (path === paths[0]) {
        const text = f.memory.entries.get(paths[1].toLowerCase())!.text!;
        // Same byte length, different content: only the digest can tell.
        f.memory.put(paths[1], { text: `X${text.slice(1)}` });
      }
      return Promise.resolve();
    });
    const start = await f.execute(preview);
    await settleJobs();
    const job = await finishPnpmJob(f.service, start.jobId);
    expect(job).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
    });
    expect(job.npmRepair?.failed?.path).toBe(paths[1]);
  });

  it('fails a repair whose deletions did not take effect and releases the gate (G3-3)', async () => {
    const f = setup('broken');
    const preview = await f.ready('repair');
    f.rm.mockImplementation(() => Promise.resolve()); // no-op: nothing removed
    const start = await f.execute(preview);
    await settleJobs();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'POSTCONDITION_FAILED',
      mutationSpawned: false,
      mayHaveChanged: true,
      gateHeld: false,
    });
  });

  it('fails a change whose installed overlay version is wrong (G3-3)', async () => {
    const f = setup('absent');
    const preview = await f.ready('change');
    const start = await f.execute(preview);
    await f.service.waitForPreflight(start.jobId);
    await settleJobs();
    f.present('12.0.0'); // npm exited 0 but another version is in place
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'POSTCONDITION_FAILED',
      gateHeld: false,
    });
  });

  it('keeps npmVersion when npm inventory fails', async () => {
    const f = setup('broken');
    const start = await f.service.inventory({ requestId: f.uuid() });
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'completed',
    });
    expect(f.service.getSnapshot()?.managers[0]).toMatchObject({
      manager: 'npm',
      available: false,
      reason: 'INVENTORY_FAILED',
      npmVersion: { bundledVersion: '11.17.0', overlayState: 'broken' },
    });
  });
});

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
      deprecatedVersions: [],
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

function setupNpmService(change: boolean, version: string) {
  const fixture = testRuntime();
  const facts = testFacts(change);
  facts.location.tool.version = version;
  jest
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn mock, never called with this
    .mocked(fixture.runtime.resolveTool)
    .mockImplementation((manager) =>
      Promise.resolve(
        manager === 'npm' ? facts.location.tool : testLocation(manager).tool,
      ),
    );
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
      deprecatedVersions: [],
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
    expect(job.preview!.managerVersion).toBe(version);
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
  it('keeps pnpm available when the API inherits npm run environment', async () => {
    const f = setupPnpmService();
    f.fs.put(Q.yaml, {
      text: `globalDir: '${Q.global}'\nglobalBinDir: '${Q.bin}'\n`,
    });
    Object.assign(f.runtime.environment, {
      USERPROFILE: Q.profile,
      XDG_CONFIG_HOME: 'D:\\TEST\\xdg',
      npm_config_prefix: 'D:\\TEST\\npm',
      npm_config_globalconfig: 'D:\\TEST\\npm\\etc\\npmrc',
      npm_config_userconfig: Q.auth,
      npm_config_cache: 'D:\\TEST\\npm-cache',
      npm_config_node_gyp: 'D:\\TEST\\npm\\node-gyp.js',
      npm_config_user_agent: 'npm/11.13.0 node/v24.16.0 win32 x64',
    });
    for (const path of [Q.home, Q.bin, f.location.cwd])
      f.fs.put(path, { directory: true });
    f.discover.mockImplementation((manager, deps) =>
      manager === 'npm'
        ? Promise.resolve({ ...testLocation(), ...testFacts().location })
        : readPnpmGlobalConfig({
            fs: f.runtime.fs,
            environment: f.runtime.environment,
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
    const start = await f.service.inventory({ requestId: f.uuid() });
    expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
      'completed',
    );
    expect(f.service.getSnapshot()!.managers).toEqual([
      expect.objectContaining({ manager: 'npm', available: true }),
      expect.objectContaining({
        manager: 'pnpm',
        available: true,
        reason: null,
      }),
    ]);
    expect(f.child.launch).not.toHaveBeenCalled();
  });

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

  it('keeps both inventories when static npm-self facts are unavailable', async () => {
    const f = setupPnpmService();
    jest.spyOn(npmOverlayAdapter, 'readNpmSelfFacts').mockRejectedValue(
      new AppException(409, 'TEST unreadable npm facts', 'CONFLICT', {
        reason: 'INVENTORY_FAILED',
      }),
    );
    const start = await f.service.inventory({ requestId: f.uuid() });
    expect((await finishPnpmJob(f.service, start.jobId)).status).toBe(
      'completed',
    );
    const [npm, pnpm] = f.service.getSnapshot()!.managers;
    expect(npm).toMatchObject({ manager: 'npm', available: true });
    expect(npm.npmVersion).toBeUndefined();
    expect(pnpm).toMatchObject({ manager: 'pnpm', available: true });
    expect(f.child.launch).not.toHaveBeenCalled();
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

  // Owner RT1: static pnpm discovery never registered the tool, so launch refused it (SPAWN_FAILED).
  it('verifies and registers the pnpm tool right before launching the mutation', async () => {
    const f = setupPnpmService();
    const preview = await f.ready();
    const resolveTool = jest.spyOn(f.runtime, 'resolveTool');
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    expect(resolveTool).toHaveBeenCalledWith(
      'pnpm',
      expect.any(AbortSignal) as unknown,
    );
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(resolveTool.mock.invocationCallOrder[0]).toBeLessThan(
      f.child.launch.mock.invocationCallOrder[0],
    );
    f.child.exit();
    expect(await finishPnpmJob(f.service, start.jobId)).toMatchObject({
      status: 'completed',
    });
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

describe.each(TEST_NPM_VERSIONS)('M7 RAM reads (npm %s)', (v) => {
  const setup = (change = false) => setupNpmService(change, v);
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

describe.each(TEST_NPM_VERSIONS)('M7 execute/preview (npm %s)', (v) => {
  const setup = (change = false) => setupNpmService(change, v);
  it('refuses changed config bytes after preview', async () => {
    const f = setup();
    const preview = await f.ready();
    f.fs.put(f.facts.location.userConfig, {
      text: 'strict-npmrc=true\n',
    });
    const start = await f.service.execute(f.consent(preview));
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_CHANGED',
      mutationSpawned: false,
      gateHeld: false,
    });
    expect(f.child.launch).not.toHaveBeenCalled();
  });

  it.each(['npm', 'npx', 'node', 'pnpm'])(
    'refuses a target claiming the protected %s bin',
    async (name) => {
      const f = setup(true);
      f.target.mockResolvedValue({
        ...testFacts(true).target!,
        bins: [{ name, target: 'bin/tool.js' }],
      });
      const start = await f.service.preview(
        testRequest({ action: 'change', targetVersion: 'latest' }),
      );
      expect(await done(f.service, start.jobId)).toMatchObject({
        status: 'failed',
        failureCode: 'PROTECTED_PACKAGE',
        preview: null,
      });
      expect(f.child.launch).not.toHaveBeenCalled();
    },
  );

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

describe.each(TEST_NPM_VERSIONS)('M7 audit/postconditions (npm %s)', (v) => {
  const setup = (change = false) => setupNpmService(change, v);
  it('preserves strict config after command failure without retry', async () => {
    const f = setup();
    const path = f.facts.location.userConfig;
    const text = 'strict-npmrc=true\n';
    f.fs.put(path, { text });
    const preview = await f.ready();
    const start = await f.service.execute(f.consent(preview));
    await flushJobs();
    f.child.exit({ exitCode: 1, failureCode: 'COMMAND_FAILED' });
    expect(await done(f.service, start.jobId)).toMatchObject({
      status: 'failed',
      failureCode: 'COMMAND_FAILED',
      mutationSpawned: true,
      gateHeld: false,
    });
    expect(f.child.launch).toHaveBeenCalledTimes(1);
    expect(f.child.launch.mock.calls[0][0].args).not.toContain(
      '--strict-npmrc=false',
    );
    const retained = f.fs.entries.get(win32.resolve(path).toLowerCase());
    expect(retained?.text).toBe(text);
  });

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

describe.each(TEST_NPM_VERSIONS)('M7 cancellation/shutdown (npm %s)', (v) => {
  const setup = (change = false) => setupNpmService(change, v);
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
