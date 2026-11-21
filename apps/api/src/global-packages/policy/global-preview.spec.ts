import 'reflect-metadata';
import { Stats } from 'node:fs';
import { AppException } from '@/common/exceptions/app.exception';
import { getGlobalRisk } from '@/global-packages/policy/global-policy';
import {
  assertGlobalPreviewUnchanged,
  createGlobalPreview,
  GlobalPreviewStore,
  GLOBAL_PREVIEW_BYTES,
  GLOBAL_PREVIEW_LIMIT,
  GLOBAL_PREVIEW_TTL_MS,
  snapshotGlobalPreviewFacts,
  validateGlobalConfirmation,
} from '@/global-packages/policy/global-preview';
import type { IGlobalPreviewFacts } from '@/global-packages/interfaces/global-packages.runtime';
import {
  testClock,
  testConsent,
  testFacts,
  testIdentity,
  testPreview,
  testRequest,
  TEST_PREVIEW_ID,
} from '@/global-packages/__fixtures__/global-lifecycle';
import { expectGlobalReason } from '@/global-packages/__fixtures__/global-adapters';
import {
  plainPnpmPreviewFacts,
  pnpmPreviewFacts,
} from '@/global-packages/__fixtures__/pnpm11/inventory';
import { pnpm12PreviewFacts } from '@/global-packages/__fixtures__/pnpm12/inventory';
import type { IPnpmGlobalGroupFacts } from '@/global-packages/interfaces/pnpm-global.types';
import {
  pnpm10InventoryFixture,
  pnpm10PrivateHoistFixture,
} from '../__fixtures__/pnpm10/inventory';
import { readPnpm10GlobalInventory } from '../discovery/pnpm10-global-inventory';

describe('pnpm 10 preview facts', () => {
  it('pins a coherent private graph extension without exposing transitive preview rows', async () => {
    const a = await pnpm10PrivateHoistFixture();
    const b = await pnpm10PrivateHoistFixture(true);
    const capture = async (h: typeof a) => {
      const result = await readPnpm10GlobalInventory(h.location, h.deps);
      expect(result.ownershipComplete).toBe(true);
      return snapshotGlobalPreviewFacts({
        location: h.location,
        current: result.facts.find((dep) => dep.name === 'wrap-ansi')!,
        target: null,
        binOwners: result.binOwners,
        pnpm10Inventory: result.pnpm10Inventory!,
      });
    };
    const expected = await capture(a);
    const actual = await capture(b);
    const preview = createGlobalPreview(
      TEST_PREVIEW_ID,
      testRequest({ manager: 'pnpm', package: 'wrap-ansi' }),
      expected,
      testClock().now(),
    );
    expect(preview.sharedPackages).toEqual([
      { name: 'cliui', version: '8.0.1', linked: false },
    ]);
    expect(actual.pnpm10Inventory.project.dependencies).toEqual(
      expected.pnpm10Inventory.project.dependencies,
    );
    expect(actual.pnpm10Inventory.project.files).toHaveLength(
      expected.pnpm10Inventory.project.files.length + 1,
    );
    await expectGlobalReason(
      () => assertGlobalPreviewUnchanged(expected, actual),
      'PREVIEW_CHANGED',
    );
  });
  async function facts10() {
    const h = await pnpm10InventoryFixture(6);
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    return {
      location: h.location,
      current: r.facts.find((f) => f.name === 'semver')!,
      target: null,
      binOwners: r.binOwners,
      pnpm10Inventory: r.pnpm10Inventory!,
    };
  }
  it('snapshots executable stat methods safely and exposes sorted shared packages', async () => {
    const facts = await facts10();
    const snap = snapshotGlobalPreviewFacts(facts);
    facts.pnpm10Inventory.project.dependencies[0].spec = 'TEST changed';
    expect(snap.pnpm10Inventory.project.dependencies[0].spec).not.toBe(
      'TEST changed',
    );
    const preview = createGlobalPreview(
      TEST_PREVIEW_ID,
      testRequest({ manager: 'pnpm', package: 'semver' }),
      snap,
      testClock().now(),
    );
    expect(preview.sharedPackages).toEqual(
      snap.pnpm10Inventory.project.dependencies
        .filter((d) => d.name !== 'semver')
        .map(({ name, version, linked }) => ({ name, version, linked }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    expect(preview.warningCodes).toContain('PNPM_SHARED_GLOBAL_PROJECT');
    expect(preview.risk).toEqual(getGlobalRisk());
  });
  it.each([
    'selector',
    'absence',
    'config',
    'store',
    'file',
    'neighbour',
    'link',
    'slot',
    'shim',
    'ancillary',
  ])('refuses pnpm 10 drift: %s', async (kind) => {
    const expected = snapshotGlobalPreviewFacts(await facts10());
    const actual = structuredClone(expected);
    const inventory = actual.pnpm10Inventory;
    if (kind === 'selector')
      actual.location.pnpm10.selectors = { HOME: 'E:\\TEST\\changed' };
    if (kind === 'absence') actual.location.pnpm10.missingConfigPaths = [];
    if (kind === 'config')
      actual.location.pnpm10.configIdentities = [
        ...actual.location.pnpm10.configIdentities,
        inventory.project.files[0],
      ];
    if (kind === 'store') inventory.project.storeDir = 'E:\\TEST\\changed';
    if (kind === 'file') inventory.project.files[0].sha256 = 'changed';
    if (kind === 'neighbour')
      inventory.project.dependencies[0].spec = 'changed';
    if (kind === 'link')
      inventory.project.dependencies[0].realPath = 'E:\\TEST\\changed';
    if (kind === 'slot') inventory.binSlots[0].name = 'changed';
    if (kind === 'shim')
      inventory.project.dependencies.find(
        (d) => d.shims.length,
      )!.shims[0].sha256 = 'changed';
    if (kind === 'ancillary')
      inventory.project.ancillary[0].realPath = 'E:\\TEST\\changed';
    await expectGlobalReason(
      () => assertGlobalPreviewUnchanged(expected, actual),
      'PREVIEW_CHANGED',
    );
  });
  it('ignores order and atime but retains the byte cap', async () => {
    const expected = snapshotGlobalPreviewFacts(await facts10());
    const actual = structuredClone(expected);
    actual.pnpm10Inventory.project.dependencies = [
      ...actual.pnpm10Inventory.project.dependencies,
    ].reverse();
    Object.assign(actual.pnpm10Inventory.binSlots[0].identity.stat, {
      atimeMs: 999,
    });
    expect(() => assertGlobalPreviewUnchanged(expected, actual)).not.toThrow();
    const preview = createGlobalPreview(
      TEST_PREVIEW_ID,
      testRequest({ manager: 'pnpm', package: 'semver' }),
      expected,
      testClock().now(),
    );
    actual.pnpm10Inventory.project.dependencies[0].spec = 'x'.repeat(
      GLOBAL_PREVIEW_BYTES,
    );
    const store = new GlobalPreviewStore(testClock());
    expect(() => store.put(preview, actual)).toThrow();
  });
  it('pins identity kinds as data before stat methods are stripped', async () => {
    const expected = snapshotGlobalPreviewFacts(await facts10());
    const actual = await facts10();
    actual.pnpm10Inventory.binSlots[0].identity.stat.isSymbolicLink = () =>
      true;
    await expectGlobalReason(
      () => assertGlobalPreviewUnchanged(expected, actual),
      'PREVIEW_CHANGED',
    );
  });
});

describe('M7 preview construction and server confirmation', () => {
  it('builds a remove preview with shared high risk and declared bin diff', () => {
    const facts = testFacts();
    const preview = createGlobalPreview(
      TEST_PREVIEW_ID,
      testRequest(),
      facts,
      testClock().now(),
    );
    expect(preview).toMatchObject({
      previewId: TEST_PREVIEW_ID,
      action: 'remove',
      currentVersion: '1.0.0',
      requestedVersion: null,
      targetVersion: null,
      confirmText: 'REMOVE GLOBAL npm test-tool',
      risk: getGlobalRisk(),
      bins: {
        before: facts.current.bins,
        after: [],
        removed: facts.current.bins,
      },
    });
    expect(preview.warningCodes).toEqual(
      expect.arrayContaining([
        'GLOBAL_CODE_EXECUTION',
        'GLOBAL_CONSUMERS_UNKNOWN',
        'PROCESS_ESCAPE_RESIDUAL',
      ]),
    );
    expect(preview).not.toHaveProperty('configIdentities');
    expect(preview).not.toHaveProperty('tool');
  });

  it('pins a tag to an exact target and reports added, removed and replaced bins', () => {
    const facts = testFacts(true);
    facts.current.bins.push({ name: 'test-old', target: 'old.js' });
    facts.target!.bins.push({ name: 'test-new', target: 'new.js' });
    const preview = createGlobalPreview(
      TEST_PREVIEW_ID,
      testRequest({ action: 'change', targetVersion: 'latest' }),
      facts,
      testClock().now(),
    );
    expect(preview).toMatchObject({
      requestedVersion: 'latest',
      targetVersion: '2.0.0',
      confirmText: 'CHANGE GLOBAL npm test-tool TO 2.0.0',
      bins: {
        added: [{ name: 'test-new', target: 'new.js' }],
        removed: [{ name: 'test-old', target: 'old.js' }],
        replaced: [
          {
            before: { name: 'test-tool', target: 'bin/tool.js' },
            after: { name: 'test-tool', target: 'dist/tool.js' },
          },
        ],
      },
    });
    expect(preview.warningCodes).toContain('MAJOR_VERSION_CHANGE');
  });

  it('accepts exact server text and a superset of acknowledged risk codes', () => {
    expect(() =>
      validateGlobalConfirmation(
        testPreview(),
        testConsent({
          acknowledgedRisks: ['MACHINE_WIDE', 'TEST-extra'],
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    { confirm: false as unknown as true },
    { acknowledgedRisks: [] },
    { confirmText: ' REMOVE GLOBAL npm test-tool' },
    { confirmText: 'REMOVE GLOBAL npm test-tool ' },
    { confirmText: 'remove global npm test-tool' },
    { confirmText: 'REMOVE GLOBAL pnpm test-tool' },
  ])('rejects altered consent %p through the shared validator', (patch) => {
    expect(() =>
      validateGlobalConfirmation(testPreview(), testConsent(patch)),
    ).toThrow(AppException);
  });

  it('recomputes MACHINE_WIDE even if a supplied risk object says low', () => {
    const preview = testPreview();
    preview.risk = { level: 'low', reasons: [] };
    expect(() =>
      validateGlobalConfirmation(
        preview,
        testConsent({
          acknowledgedRisks: [],
          confirmText: '',
        }),
      ),
    ).toThrow(AppException);
  });
});

describe('M7 ready preview store', () => {
  it('retains plain independent snapshots of native Stats and own-method stats', () => {
    const facts = testFacts();
    // Reuse the native prototype without calling Node's private Stats constructor.
    const nativeStat: Stats = Object.assign(
      Object.create(Stats.prototype) as Stats,
      {
        dev: 1,
        ino: 2,
        size: 32,
        mode: 0o100644,
        nlink: 1,
        uid: 1,
        gid: 1,
        rdev: 0,
        blksize: 4096,
        blocks: 1,
        atimeMs: 5,
        mtimeMs: 3,
        ctimeMs: 4,
        birthtimeMs: 1,
        atime: new Date(5),
        mtime: new Date(3),
        ctime: new Date(4),
        birthtime: new Date(1),
      },
    );
    expect(nativeStat).toBeInstanceOf(Stats);
    expect(nativeStat.isFile()).toBe(true);
    facts.current.manifest.file = {
      ...facts.current.manifest.file,
      stat: nativeStat,
    };
    facts.location.tool.identities = [testIdentity(facts.location.tool.file)];
    facts.location.tool.npm10InstallCompatIdentities = [
      testIdentity('D:\\TEST\\npm10-compat.cjs'),
    ];
    facts.current.binIdentities = [testIdentity('D:\\TEST\\test-tool.cmd')];
    facts.location.configIdentities[0].file = testIdentity(
      facts.location.userConfig,
    );
    facts.locations = [
      facts.location,
      {
        ...facts.location,
        manager: 'pnpm',
        tool: {
          ...facts.location.tool,
          manager: 'pnpm',
          npm10InstallCompatIdentities: [
            testIdentity('D:\\TEST\\sibling-npm10-compat.cjs'),
          ],
        },
      },
    ];
    const store = new GlobalPreviewStore(testClock());
    store.put(testPreview(), facts);
    const retained = store.get(TEST_PREVIEW_ID).facts;
    const files = [
      retained.current!.manifest.file,
      ...retained.current!.binIdentities,
      ...retained.location.tool.identities,
      ...(retained.location.tool.npm10InstallCompatIdentities ?? []),
      ...retained.location.configIdentities.map((identity) => identity.file),
      ...retained.locations!.flatMap((location) => [
        ...location.tool.identities,
        ...(location.tool.npm10InstallCompatIdentities ?? []),
        ...location.configIdentities.map((identity) => identity.file),
      ]),
    ];
    for (const file of files) {
      expect(Object.getPrototypeOf(file.stat)).toBe(
        Object.getPrototypeOf(structuredClone({})),
      );
      expect(file.stat).not.toBeInstanceOf(Stats);
      expect(
        Object.values(file.stat).some((value) => typeof value === 'function'),
      ).toBe(false);
    }
    expect(() => structuredClone(retained)).not.toThrow();
    expect(() => assertGlobalPreviewUnchanged(retained, facts)).not.toThrow();
    const compatDrift = structuredClone(retained);
    compatDrift.locations![1].tool.npm10InstallCompatIdentities![0].stat.ino = 9999;
    expect(() => assertGlobalPreviewUnchanged(retained, compatDrift)).toThrow(
      AppException,
    );
    nativeStat.ino = 99;
    retained.current!.manifest.file.stat.ino = 77;
    expect(
      store.get(TEST_PREVIEW_ID).facts.current!.manifest.file.stat.ino,
    ).toBe(2);
  });

  it('starts TTL at ready, using monotonic time despite wall clock jumps', () => {
    const clock = testClock();
    const store = new GlobalPreviewStore(clock);
    clock.advance(90_000);
    const ready = store.put(testPreview(), testFacts());
    expect(Date.parse(ready.expiresAt) - Date.parse(ready.createdAt)).toBe(
      GLOBAL_PREVIEW_TTL_MS,
    );
    expect(ready.createdAt).toBe(clock.now().toISOString());
    clock.jumpWall(24 * 60 * 60 * 1000);
    clock.advance(GLOBAL_PREVIEW_TTL_MS - 1);
    expect(store.get(TEST_PREVIEW_ID).preview.previewId).toBe(TEST_PREVIEW_ID);
  });

  it.each(['get', 'consume'] as const)(
    'refuses %s exactly at expiry',
    async (method) => {
      const clock = testClock();
      const store = new GlobalPreviewStore(clock);
      store.put(testPreview(), testFacts());
      clock.advance(GLOBAL_PREVIEW_TTL_MS);
      await expectGlobalReason(
        () => store[method](TEST_PREVIEW_ID),
        'PREVIEW_EXPIRED',
      );
    },
  );

  it('does not extend lifetime when read or when the wall clock moves backwards', async () => {
    const clock = testClock();
    const store = new GlobalPreviewStore(clock);
    store.put(testPreview(), testFacts());
    clock.advance(GLOBAL_PREVIEW_TTL_MS - 1);
    store.get(TEST_PREVIEW_ID);
    clock.jumpWall(-86400_000);
    clock.advance(1);
    await expectGlobalReason(
      () => store.consume(TEST_PREVIEW_ID),
      'PREVIEW_EXPIRED',
    );
  });

  it('consumes synchronously once, including concurrent callers in the same turn', async () => {
    const store = new GlobalPreviewStore(testClock());
    store.put(testPreview(), testFacts());
    expect(store.consume(TEST_PREVIEW_ID).preview.previewId).toBe(
      TEST_PREVIEW_ID,
    );
    await expectGlobalReason(
      () => store.consume(TEST_PREVIEW_ID),
      'PREVIEW_CONSUMED',
    );
  });

  it('defensively copies both public preview and private facts', () => {
    const store = new GlobalPreviewStore(testClock());
    const preview = testPreview();
    const facts = testFacts();
    store.put(preview, facts);
    preview.confirmText = 'TEST tampered';
    facts.current.version = '9.9.9';
    const first = store.get(TEST_PREVIEW_ID);
    first.preview.risk.reasons.length = 0;
    first.facts.binOwners.length = 0;
    const second = store.get(TEST_PREVIEW_ID);
    expect(second.preview.confirmText).toBe('REMOVE GLOBAL npm test-tool');
    expect(second.preview.risk).toEqual(getGlobalRisk());
    expect(second.facts.current!.version).toBe('1.0.0');
    expect(second.facts.binOwners).toHaveLength(1);
  });

  it('evicts oldest ready records beyond 16, without reconstructing them', () => {
    const store = new GlobalPreviewStore(testClock());
    for (let i = 0; i <= GLOBAL_PREVIEW_LIMIT; i++) {
      store.put({ ...testPreview(), previewId: `TEST-${i}` }, testFacts());
    }
    expect(() => store.get('TEST-0')).toThrow(AppException);
    expect(store.get('TEST-16').preview.previewId).toBe('TEST-16');
  });

  it('rejects an oversized private fact record as well as oversized public data', async () => {
    const store = new GlobalPreviewStore(testClock());
    const facts = testFacts();
    facts.current.manifest.sha256 = 'x'.repeat(GLOBAL_PREVIEW_BYTES);
    await expectGlobalReason(
      () => store.put(testPreview(), facts),
      'LIMIT_EXCEEDED',
    );
    const preview = testPreview();
    preview.confirmText = 'x'.repeat(GLOBAL_PREVIEW_BYTES);
    await expectGlobalReason(
      () => store.put(preview, testFacts()),
      'LIMIT_EXCEEDED',
    );
  });

  it('cannot reset a consumed record or extend its TTL by overwriting an ID', () => {
    const store = new GlobalPreviewStore(testClock());
    store.put(testPreview(), testFacts());
    store.consume(TEST_PREVIEW_ID);
    expect(() => store.put(testPreview(), testFacts())).toThrow(AppException);
  });

  it('drops every manager preview on invalidation and rejects unknown/unready IDs', () => {
    const store = new GlobalPreviewStore(testClock());
    store.put(testPreview(), testFacts());
    store.clear();
    expect(() => store.get(TEST_PREVIEW_ID)).toThrow(AppException);
    expect(() => store.consume('TEST-never-ready')).toThrow(AppException);
  });
});

type FactsChange = (facts: IGlobalPreviewFacts) => void;
const changes: [string, FactsChange][] = [
  [
    'tool version',
    (f) => {
      f.location.tool.version = '11.99.0';
    },
  ],
  [
    'tool launcher',
    (f) => {
      f.location.tool.file = 'D:\\TEST\\other-node.exe';
    },
  ],
  [
    'tool entry',
    (f) => {
      f.location.tool.entry = 'D:\\TEST\\other.js';
    },
  ],
  [
    'tool identity',
    (f) => {
      f.location.tool.identities = [];
    },
  ],
  [
    'global root',
    (f) => {
      f.location.globalRoot += '-moved';
    },
  ],
  [
    'prefix',
    (f) => {
      f.location.prefix += '-moved';
    },
  ],
  [
    'bin directory',
    (f) => {
      f.location.binDir += '-moved';
    },
  ],
  [
    'cache',
    (f) => {
      f.location.cacheDir += '-moved';
    },
  ],
  [
    'config content',
    (f) => {
      f.location.configIdentities[0].sha256 += '-changed';
    },
  ],
  [
    'config identity',
    (f) => {
      f.location.configIdentities[0].file = testIdentity(
        'D:\\TEST\\replaced.npmrc',
      );
    },
  ],
  [
    'config disappearance',
    (f) => {
      f.location.configIdentities = [];
    },
  ],
  [
    'package identity',
    (f) => {
      f.current!.packageRoot += '-moved';
    },
  ],
  [
    'current version',
    (f) => {
      f.current!.version = '1.0.1';
    },
  ],
  [
    'current manifest',
    (f) => {
      f.current!.manifest.sha256 += '-changed';
    },
  ],
  [
    'current bins',
    (f) => {
      f.current!.bins[0].target = 'other.js';
    },
  ],
  [
    'shim identity',
    (f) => {
      f.current!.binIdentities = [];
    },
  ],
  [
    'bin ownership',
    (f) => {
      f.binOwners[0].owner = 'test-other';
    },
  ],
  [
    'moved tag',
    (f) => {
      f.target!.version = '3.0.0';
    },
  ],
  [
    'target manifest',
    (f) => {
      f.target!.manifestHash += '-changed';
    },
  ],
  [
    'target integrity',
    (f) => {
      f.target!.integrity += '-changed';
    },
  ],
  [
    'target bins',
    (f) => {
      f.target!.bins[0].name = 'node';
    },
  ],
  [
    'target disappearance',
    (f) => {
      f.target = null;
    },
  ],
];

describe('M7 execute comparator', () => {
  it.each(changes)(
    'refuses changed %s before mutation',
    async (_label, change) => {
      const expected = testFacts(true);
      const actual = structuredClone(expected);
      change(actual);
      await expectGlobalReason(
        () => assertGlobalPreviewUnchanged(expected, actual),
        'PREVIEW_CHANGED',
      );
    },
  );

  it('ignores record ordering and access time, retaining all safety facts', () => {
    const expected = testFacts(true);
    expected.binOwners.push({ name: 'test-other', owner: 'test-other' });
    expected.location.configIdentities.push({
      file: testIdentity('D:\\TEST\\global.npmrc'),
      sha256: 'TEST-global-hash',
    });
    expected.current.bins.push({ name: 'test-extra', target: 'extra.js' });
    const actual = snapshotGlobalPreviewFacts(expected);
    actual.binOwners.reverse();
    actual.location.configIdentities.reverse();
    actual.current.bins.reverse();
    Object.assign(actual.current.manifest.file.stat, { atimeMs: 999 });
    expect(() => assertGlobalPreviewUnchanged(expected, actual)).not.toThrow();
  });
});

const pnpmChanges: [string, FactsChange][] = [
  [
    'pnpm shim content',
    (f) => {
      f.pnpmInventory!.shimIdentities![0].sha256 = 'changed';
    },
  ],
  [
    'pnpm shim file identity',
    (f) => {
      f.pnpmInventory!.shimIdentities![0].file.stat.ino = 99;
    },
  ],
  [
    'pnpm home',
    (f) => {
      f.location.pnpm!.homeDir += '-moved';
    },
  ],
  [
    'pnpm store',
    (f) => {
      f.location.pnpm!.storeDir += '-moved';
    },
  ],
  [
    'pnpm state',
    (f) => {
      f.location.pnpm!.stateDir += '-moved';
    },
  ],
  [
    'pnpm config directory',
    (f) => {
      f.location.pnpm!.configDir += '-moved';
    },
  ],
  [
    'pnpm original PATH membership',
    (f) => {
      f.location.pnpm!.originalPath = [];
    },
  ],
  [
    'pnpm selector',
    (f) => {
      f.location.pnpm!.selectors = { PNPM_HOME: 'D:\\TEST\\other-home' };
    },
  ],
  [
    'pnpm source content',
    (f) => {
      f.location.pnpm!.configIdentities[0].sha256 = 'changed';
    },
  ],
  [
    'pnpm source identity',
    (f) => {
      f.location.pnpm!.configIdentities[0].file.stat.ino = 99;
    },
  ],
  [
    'pnpm source appearance',
    (f) => {
      f.location.pnpm!.missingConfigPaths = [];
    },
  ],
  [
    'pnpm directory appearance',
    (f) => {
      f.location.pnpm!.missingDirectoryPaths = [];
    },
  ],
  [
    'pnpm directory identity',
    (f) => {
      f.location.pnpm!.directoryIdentities[0].stat.ino = 99;
    },
  ],
  [
    'pnpm policy',
    (f) => {
      f.location.pnpm!.policy.unknownRouting = true;
    },
  ],
  [
    'pnpm build policy',
    (f) => {
      f.location.pnpm!.safety.allowBuilds = { 'test-native': true };
    },
  ],
  [
    'pnpm release age',
    (f) => {
      f.location.pnpm!.safety.minimumReleaseAge = 0;
    },
  ],
  [
    'pnpm config disappearance',
    (f) => {
      delete f.location.pnpm;
    },
  ],
  [
    'group index identity',
    (f) => {
      f.pnpmInventory!.groups[0].index.identity.stat.ino = 99;
    },
  ],
  [
    'group index target',
    (f) => {
      f.pnpmInventory!.groups[0].index.realPath += '-moved';
    },
  ],
  [
    'group install directory',
    (f) => {
      f.pnpmInventory!.groups[0].installDir += '-moved';
    },
  ],
  [
    'group directory identity',
    (f) => {
      f.pnpmInventory!.groups[0].directory.stat.ino = 99;
    },
  ],
  [
    'group direct dependencies',
    (f) => {
      f.pnpmInventory!.groups[0].directDependencies = ['other'];
    },
  ],
  [
    'group package link identity',
    (f) => {
      f.pnpmInventory!.groups[0].packageLinks[0].identity.stat.ino = 99;
    },
  ],
  [
    'group package link target',
    (f) => {
      f.pnpmInventory!.groups[0].packageLinks[0].realPath += '-moved';
    },
  ],
  [
    'group package link path',
    (f) => {
      f.pnpmInventory!.groups[0].packageLinks[0].logicalPath += '-moved';
    },
  ],
  [
    'group store root',
    (f) => {
      f.pnpmInventory!.groups[0].storeDir += '-moved';
    },
  ],
  [
    'group virtual store root',
    (f) => {
      f.pnpmInventory!.groups[0].virtualStoreDir += '-moved';
    },
  ],
  [
    'group disappearance',
    (f) => {
      f.pnpmInventory!.groups = [];
    },
  ],
  [
    'ownership completeness',
    (f) => {
      f.pnpmInventory!.ownershipComplete = false;
    },
  ],
  [
    'orphan appearance',
    (f) => {
      f.pnpmInventory!.unreferencedDirectories = [
        testIdentity(
          'D:\\TEST\\pnpm-global\\v11\\81fe-1a1aa104925-e77952ba3460596f',
        ),
      ];
    },
  ],
  [
    'inventory disappearance',
    (f) => {
      delete f.pnpmInventory;
    },
  ],
  [
    'current group identity',
    (f) => {
      f.current!.pnpmGroup!.directory.stat.ino = 99;
    },
  ],
  [
    'current group disappearance',
    (f) => {
      delete f.current!.pnpmGroup;
    },
  ],
  [
    'pnpm shim identity',
    (f) => {
      f.current!.binIdentities[0].stat.ino = 99;
    },
  ],
];
const metadataKeys = [
  'manifest',
  'lockfile',
  'modules',
  'packageMap',
  'virtualStoreLockfile',
] as const;
for (const name of metadataKeys) {
  pnpmChanges.push(
    [
      `group ${name} content`,
      (f) => {
        f.pnpmInventory!.groups[0][name]!.sha256 = 'changed';
      },
    ],
    [
      `group ${name} identity`,
      (f) => {
        f.pnpmInventory!.groups[0][name]!.file.stat.ino = 99;
      },
    ],
  );
}

function groupFiles(group: IPnpmGlobalGroupFacts) {
  return [
    group.index.identity,
    group.directory,
    ...metadataKeys.map((name) => group[name]!.file),
    ...group.packageLinks.map((link) => link.identity),
  ];
}

describe('pnpm 11 preview config, group and link facts', () => {
  it.each(pnpmChanges)(
    'refuses changed %s before any mutation launch',
    async (_name, change) => {
      const expected = plainPnpmPreviewFacts();
      const actual = plainPnpmPreviewFacts();
      change(actual);
      const launch = jest.fn<void, []>();
      await expectGlobalReason(() => {
        assertGlobalPreviewUnchanged(expected, actual);
        launch();
      }, 'PREVIEW_CHANGED');
      expect(launch).not.toHaveBeenCalled();
    },
  );

  it('retains plain independent config, group and link stat snapshots', () => {
    const live = pnpmPreviewFacts();
    live.pnpmInventory!.unreferencedDirectories = [
      testIdentity('D:\\TEST\\orphan'),
    ];
    const retained = snapshotGlobalPreviewFacts(live);
    const files = [
      ...retained.location.pnpm!.directoryIdentities,
      ...retained.location.pnpm!.configIdentities.map((config) => config.file),
      ...groupFiles(retained.current.pnpmGroup!),
      ...retained.pnpmInventory!.groups.flatMap(groupFiles),
      ...retained.pnpmInventory!.unreferencedDirectories,
      ...retained.pnpmInventory!.shimIdentities!.map(
        (identity) => identity.file,
      ),
    ];
    for (const file of files) {
      expect(
        Object.values(file.stat).some((value) => typeof value === 'function'),
      ).toBe(false);
    }
    expect(() => structuredClone(retained)).not.toThrow();
    live.location.pnpm!.directoryIdentities[0].stat.ino = 99;
    live.pnpmInventory!.groups[0].index.identity.stat.ino = 99;
    expect(retained.location.pnpm!.directoryIdentities[0].stat.ino).toBe(2);
    expect(retained.pnpmInventory!.groups[0].index.identity.stat.ino).toBe(2);
  });

  it('pins pnpm config even when npm is the selected manager', async () => {
    const expected = testFacts();
    expected.locations = [expected.location, plainPnpmPreviewFacts().location];
    const actual = JSON.parse(JSON.stringify(expected)) as IGlobalPreviewFacts;
    actual.locations![1].pnpm!.selectors = {
      PNPM_HOME: 'D:\\TEST\\other-home',
    };
    await expectGlobalReason(
      () => assertGlobalPreviewUnchanged(expected, actual),
      'PREVIEW_CHANGED',
    );
  });

  it('pins existing orphan identities as well as orphan appearances', async () => {
    const expected = plainPnpmPreviewFacts();
    expected.pnpmInventory!.unreferencedDirectories = [
      testIdentity('D:\\TEST\\orphan'),
    ];
    const actual = JSON.parse(JSON.stringify(expected)) as IGlobalPreviewFacts;
    actual.pnpmInventory!.unreferencedDirectories[0].stat.ino = 99;
    await expectGlobalReason(
      () => assertGlobalPreviewUnchanged(expected, actual),
      'PREVIEW_CHANGED',
    );
  });

  it('accepts unchanged pnpm facts and ignores every new fact access time', () => {
    const expected = plainPnpmPreviewFacts();
    const actual = plainPnpmPreviewFacts();
    const files = [
      ...actual.location.pnpm!.directoryIdentities,
      ...actual.location.pnpm!.configIdentities.map((config) => config.file),
      ...groupFiles(actual.current.pnpmGroup!),
      ...actual.pnpmInventory!.groups.flatMap(groupFiles),
      ...actual.current.binIdentities,
      ...actual.pnpmInventory!.shimIdentities!.map((identity) => identity.file),
    ];
    for (const file of files)
      Object.assign(file.stat, { atime: new Date(999), atimeMs: 999 });
    expect(() => assertGlobalPreviewUnchanged(expected, actual)).not.toThrow();
  });

  it('ignores set ordering in config, groups, dependencies, links and orphan identities', () => {
    const expected = plainPnpmPreviewFacts();
    expected.location.pnpm!.configIdentities = [
      ...expected.location.configIdentities,
      {
        file: testIdentity('D:\\TEST\\pnpm-config\\auth.ini'),
        sha256: 'test-hash',
      },
    ];
    expected.location.pnpm!.missingConfigPaths = [
      'D:\\TEST\\one.ini',
      'D:\\TEST\\two.ini',
    ];
    expected.location.pnpm!.missingDirectoryPaths = [
      'D:\\TEST\\one',
      'D:\\TEST\\two',
    ];
    expected.location.pnpm!.policy.scopedRegistries = ['@one', '@two'];
    const group = expected.pnpmInventory!.groups[0];
    group.directDependencies = ['is-number', 'test-other'];
    group.packageLinks = [
      ...group.packageLinks,
      { ...group.packageLinks[0], logicalPath: 'D:\\TEST\\other-link' },
    ];
    const second = {
      ...group,
      installDir: `${group.installDir}-other`,
      index: {
        ...group.index,
        logicalPath: `${group.index.logicalPath}-other`,
      },
    };
    expected.pnpmInventory!.groups = [group, second];
    expected.pnpmInventory!.unreferencedDirectories = [
      testIdentity('D:\\TEST\\orphan-a'),
      testIdentity('D:\\TEST\\orphan-b'),
    ];
    const actual = JSON.parse(JSON.stringify(expected)) as IGlobalPreviewFacts;
    actual.location.pnpm!.configIdentities = [
      ...actual.location.pnpm!.configIdentities,
    ].reverse();
    actual.location.pnpm!.directoryIdentities = [
      ...actual.location.pnpm!.directoryIdentities,
    ].reverse();
    actual.location.pnpm!.missingConfigPaths = [
      ...actual.location.pnpm!.missingConfigPaths,
    ].reverse();
    actual.location.pnpm!.missingDirectoryPaths = [
      ...actual.location.pnpm!.missingDirectoryPaths,
    ].reverse();
    actual.location.pnpm!.policy.scopedRegistries = [
      ...actual.location.pnpm!.policy.scopedRegistries,
    ].reverse();
    actual.pnpmInventory!.groups = [...actual.pnpmInventory!.groups]
      .reverse()
      .map((item) => ({
        ...item,
        directDependencies: [...item.directDependencies].reverse(),
        packageLinks: [...item.packageLinks].reverse(),
      }));
    actual.pnpmInventory!.unreferencedDirectories = [
      ...actual.pnpmInventory!.unreferencedDirectories,
    ].reverse();
    expect(() => assertGlobalPreviewUnchanged(expected, actual)).not.toThrow();
  });

  it('snapshots and compares pnpm 12 preview facts with packageMap: null and detects null <-> present drift', async () => {
    const expected = pnpm12PreviewFacts();
    const actual = pnpm12PreviewFacts();
    expect(() => assertGlobalPreviewUnchanged(expected, actual)).not.toThrow();
    actual.pnpmInventory!.groups[0].packageMap = {
      file: testIdentity(
        'D:\\TEST\\pnpm-global\\v11\\1e28-18e9ffe59ef0c7d4-0\\node_modules\\.package-map.json',
      ),
      sha256: 'TEST-package-map-hash',
    };
    await expectGlobalReason(
      () => assertGlobalPreviewUnchanged(expected, actual),
      'PREVIEW_CHANGED',
    );
  });
});
