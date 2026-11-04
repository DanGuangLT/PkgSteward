import 'reflect-metadata';
import { Stats } from 'node:fs';
import { AppException } from '@/common/exceptions/app.exception';
import { getGlobalRisk } from '@/global-packages/global-policy';
import {
  assertGlobalPreviewUnchanged,
  createGlobalPreview,
  GlobalPreviewStore,
  GLOBAL_PREVIEW_BYTES,
  GLOBAL_PREVIEW_LIMIT,
  GLOBAL_PREVIEW_TTL_MS,
  snapshotGlobalPreviewFacts,
  validateGlobalConfirmation,
} from '@/global-packages/global-preview';
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
    facts.current.binIdentities = [testIdentity('D:\\TEST\\test-tool.cmd')];
    facts.location.configIdentities[0].file = testIdentity(
      facts.location.userConfig,
    );
    facts.locations = [facts.location];
    const store = new GlobalPreviewStore(testClock());
    store.put(testPreview(), facts);
    const retained = store.get(TEST_PREVIEW_ID).facts;
    const files = [
      retained.current.manifest.file,
      ...retained.current.binIdentities,
      ...retained.location.tool.identities,
      ...retained.location.configIdentities.map((identity) => identity.file),
      ...retained.locations!.flatMap((location) => [
        ...location.tool.identities,
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
    nativeStat.ino = 99;
    retained.current.manifest.file.stat.ino = 77;
    expect(
      store.get(TEST_PREVIEW_ID).facts.current.manifest.file.stat.ino,
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
    expect(second.facts.current.version).toBe('1.0.0');
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
      f.current.packageRoot += '-moved';
    },
  ],
  [
    'current version',
    (f) => {
      f.current.version = '1.0.1';
    },
  ],
  [
    'current manifest',
    (f) => {
      f.current.manifest.sha256 += '-changed';
    },
  ],
  [
    'current bins',
    (f) => {
      f.current.bins[0].target = 'other.js';
    },
  ],
  [
    'shim identity',
    (f) => {
      f.current.binIdentities = [];
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
