import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import {
  GLOBAL_ACTIONS,
  GLOBAL_JOB_KINDS,
  GLOBAL_JOB_STATUSES,
  GLOBAL_MANAGERS,
  GLOBAL_DISABLED_MANAGERS,
  GLOBAL_REASON_CODES,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  IGlobalJob,
  IGlobalPreview,
} from '@/global-packages/interfaces/global-packages.types';
import { RUN_STATUSES } from '@/npm-runner/interfaces/npm-runner.types';
import {
  GlobalJobEntity,
  GlobalSnapshotEntity,
} from '@/global-packages/entities/global-packages.entity';
import {
  assessGlobalRegistryPolicy,
  GLOBAL_CONFIG_FILE_LIMIT,
  parseGlobalNpmrc,
} from '@/global-packages/global-config';
import { normalizeGlobalBins } from '@/global-packages/global-policy';
import { assessRisk } from '@/core/risk/risk';
import {
  pnpmConfigFacts,
  PNPM_TEST_PATHS as Q,
} from '@/global-packages/__fixtures__/pnpm11/facts';
import type {
  IPnpmGlobalGroupFacts,
  IPnpmGlobalInventoryFacts,
} from '@/global-packages/interfaces/pnpm-global.types';

// Fixed, inert repository fixtures only; never a PM command or a client path.
const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');
const object = (value: unknown): Record<string, unknown> => {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
};
const json = (name: string): unknown => JSON.parse(fixture(name)) as unknown;
const preview: IGlobalPreview = {
  previewId: '00000000-0000-4000-8000-000000000002',
  createdAt: '2026-11-04T00:00:00.000Z',
  expiresAt: '2026-11-04T00:05:00.000Z',
  manager: 'npm',
  managerVersion: '11.0.0',
  action: 'change',
  package: '@test/tool',
  currentVersion: '1.2.3',
  requestedVersion: 'latest',
  targetVersion: '2.0.0',
  globalRoot: 'D:\\TEST\\m7\\npm-prefix\\node_modules',
  binDir: 'D:\\TEST\\m7\\npm-prefix',
  bins: { before: [], after: [], added: [], removed: [], replaced: [] },
  warningCodes: ['MAJOR_VERSION_CHANGE'],
  risk: assessRisk(['MACHINE_WIDE']),
  confirmText: 'CHANGE GLOBAL npm @test/tool TO 2.0.0',
};
const job: IGlobalJob = {
  jobId: '00000000-0000-4000-8000-000000000003',
  requestId: '00000000-0000-4000-8000-000000000001',
  previewId: preview.previewId,
  status: 'completed',
  kind: 'preview',
  manager: 'npm',
  managerVersion: '11.0.0',
  action: 'change',
  package: '@test/tool',
  currentVersion: '1.2.3',
  targetVersion: '2.0.0',
  phase: 'done',
  startedAt: preview.createdAt,
  finishedAt: preview.createdAt,
  mutationSpawned: false,
  mayHaveChanged: false,
  exitCode: null,
  signal: null,
  stopReason: null,
  terminationVerified: true,
  gateHeld: false,
  auditWritten: false,
  refreshRequired: false,
  failureCode: null,
  warningCodes: [],
  firstCursor: 0,
  endCursor: 0,
  droppedBytes: 0,
  preview,
  versions: null,
};

describe('global public contract and entity exclusions', () => {
  it('enables both managers while retaining disabled, setup and group reasons', () => {
    expect(GLOBAL_DISABLED_MANAGERS).toEqual([]);
    expect(GLOBAL_REASON_CODES).toEqual(
      expect.arrayContaining([
        'MANAGER_DISABLED',
        'PNPM_GLOBAL_NOT_CONFIGURED',
        'GLOBAL_GROUP_UNSUPPORTED',
      ]),
    );
    const snapshot = {
      revision: 'TEST-pnpm11',
      asOf: preview.createdAt,
      stale: false,
      managers: [
        {
          manager: 'pnpm',
          version: '11.22.0',
          available: false,
          reason: 'PNPM_GLOBAL_NOT_CONFIGURED',
          globalRoot: null,
          binDir: null,
          packages: [],
        },
      ],
    };
    expect(
      instanceToPlain(plainToInstance(GlobalSnapshotEntity, snapshot)),
    ).toEqual(snapshot);
    expect(
      instanceToPlain(
        plainToInstance(GlobalJobEntity, {
          ...job,
          manager: 'pnpm',
          failureCode: 'GLOBAL_GROUP_UNSUPPORTED',
        }),
      ),
    ).toEqual({
      ...job,
      manager: 'pnpm',
      failureCode: 'GLOBAL_GROUP_UNSUPPORTED',
    });
  });

  it('excludes pnpm config/group/GVS identities from public snapshots and previews', () => {
    const identity = {
      path: 'D:\\TEST\\group\\package.json',
      stat: {
        size: 1,
        mtimeMs: 1,
        ctimeMs: 1,
        dev: 1,
        ino: 1,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
    };
    const configIdentity = { file: identity, sha256: 'TEST-hash' };
    const link = { logicalPath: Q.root, realPath: 'D:\\TEST\\group', identity };
    const group: IPnpmGlobalGroupFacts = {
      index: link,
      installDir: link.realPath,
      directory: identity,
      manifest: configIdentity,
      lockfile: configIdentity,
      modules: configIdentity,
      packageMap: configIdentity,
      virtualStoreLockfile: configIdentity,
      directDependencies: ['is-number', 'is-odd'],
      packageLinks: [link],
      storeDir: Q.store,
      virtualStoreDir: `${Q.store}\\links`,
    };
    const inventory: IPnpmGlobalInventoryFacts = {
      groups: [group],
      unreferencedDirectories: [identity],
      ownershipComplete: false,
    };
    const projected = instanceToPlain(
      plainToInstance(GlobalJobEntity, {
        ...job,
        pnpm: pnpmConfigFacts(),
        pnpmInventory: inventory,
        preview: { ...preview, pnpm: pnpmConfigFacts(), pnpmGroup: group },
      }),
    );
    expect(projected).toEqual(job);
    expect(JSON.stringify(projected)).not.toMatch(
      /homeDir|authFile|selectors|packageLinks|unreferencedDirectories/,
    );
  });
  it('limits managers/actions/kinds and reuses the M6 status values', () => {
    expect(GLOBAL_MANAGERS).toEqual(['npm', 'pnpm']);
    expect(GLOBAL_ACTIONS).toEqual(['remove', 'change']);
    expect(GLOBAL_JOB_KINDS).toEqual([
      'inventory',
      'versions',
      'preview',
      'mutation',
    ]);
    expect(GLOBAL_JOB_STATUSES).toBe(RUN_STATUSES);
  });
  it('preserves job and ready preview fields while excluding internal facts recursively', () => {
    const privateFacts = {
      environment: { NPM_TOKEN: 'TEST-not-a-token' },
      tool: { file: 'D:\\TEST\\node.exe' },
      configIdentities: [],
      facts: {},
    };
    const entity = plainToInstance(GlobalJobEntity, {
      ...job,
      ...privateFacts,
      preview: {
        ...preview,
        ...privateFacts,
        bins: { ...preview.bins, rawConfig: 'TEST-not-a-token' },
      },
    });
    const serialized: unknown = instanceToPlain(entity);
    expect(serialized).toEqual(job);
    expect(JSON.stringify(serialized)).not.toMatch(
      /TEST-not-a-token|environment|configIdentities|rawConfig|node\.exe/,
    );
  });
  it('retains null result variants and projects snapshots without private identities', () => {
    expect(
      instanceToPlain(
        plainToInstance(GlobalJobEntity, { ...job, preview: null }),
      ),
    ).toEqual({ ...job, preview: null });
    const snapshot = {
      revision: 'TEST-1',
      asOf: preview.createdAt,
      stale: false,
      managers: [
        {
          manager: 'npm',
          version: '11.0.0',
          available: true,
          reason: null,
          globalRoot: preview.globalRoot,
          binDir: preview.binDir,
          packages: [
            {
              name: 'typescript',
              version: '5.0.0',
              bins: [],
              status: 'manageable',
              reason: null,
            },
          ],
        },
      ],
    };
    expect(
      instanceToPlain(
        plainToInstance(GlobalSnapshotEntity, { ...snapshot, environment: {} }),
      ),
    ).toEqual(snapshot);
  });
});

describe('hand-written inert TEST fixture contracts', () => {
  it.each([
    'config.yaml',
    'auth.ini',
    'public-auth.npmrc',
    'group-package.json',
    'pnpm-lock.yaml',
    'modules.yaml',
    'layout.json',
  ])('marks pnpm11/%s as inert TEST data', (name) => {
    const text = fixture(`pnpm11/${name}`);
    expect(text).toContain('TEST');
    expect(text).toContain('không phải yêu cầu nghiệp vụ');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(
      GLOBAL_CONFIG_FILE_LIMIT,
    );
    expect(text).not.toMatch(
      /"(?:scripts|preinstall|postinstall|prepare)"\s*:|BEGIN PRIVATE KEY/,
    );
  });

  it('records pnpm 11 index/group/GVS paths as data without creating real links', () => {
    const layout = object(json('pnpm11/layout.json'));
    expect(layout.index).toMatch(/^[a-f0-9]{64}$/);
    expect(layout.installDir).toMatch(
      /^[a-f0-9]{4}-[a-f0-9]{11}-[a-f0-9]{16}$/,
    );
    expect(layout.files).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'node_modules/.modules.yaml',
      'node_modules/.package-map.json',
      'node_modules/.pnpm/lock.yaml',
    ]);
    expect(layout.packageTarget).toMatch(
      /\\v11\\links\\@\\is-number\\7\.0\.0\\[a-f0-9]{64}\\node_modules\\is-number$/,
    );
    expect(object(json('pnpm11/group-package.json')).dependencies).toEqual({
      'is-number': '7.0.0',
    });
    expect(layout.groupedDependencies).toEqual({
      'is-number': '7.0.0',
      'is-odd': '3.0.1',
    });
    expect(layout.globalShims).toEqual(['semver', 'semver.CMD', 'semver.ps1']);
  });
  it.each([
    'npm-list.json',
    'pnpm-list.json',
    'manifests.json',
    'links-invalid.json',
    'public-auth.npmrc',
    'custom-scoped.npmrc',
    'interpolated.npmrc',
  ])('marks and bounds %s, with no executable lifecycle content', (name) => {
    const text = fixture(name);
    expect(text).toContain('TEST');
    expect(text).toContain('không phải yêu cầu nghiệp vụ');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(
      GLOBAL_CONFIG_FILE_LIMIT,
    );
    expect(text).not.toMatch(
      /"(?:scripts|preinstall|postinstall|prepare)"\s*:|BEGIN PRIVATE KEY/,
    );
  });
  it('keeps npm-object and pnpm-array fixtures distinct', () => {
    const npm = object(json('npm-list.json'));
    expect(Object.keys(object(npm.dependencies))).toEqual([
      '@test/tool',
      'typescript',
      'npm',
    ]);
    const pnpm = json('pnpm-list.json');
    expect(Array.isArray(pnpm)).toBe(true);
    if (!Array.isArray(pnpm)) throw new Error('TEST fixture must be an array');
    expect(Object.keys(object(object(pnpm[0]).dependencies))).toEqual([
      '@test/tool',
    ]);
  });
  it('covers string/object/binless/protected metadata without fetching artifacts', () => {
    const manifests = object(json('manifests.json'));
    expect(
      normalizeGlobalBins('@test/tool', object(manifests.current).bin),
    ).toEqual([{ name: 'test-tool', target: 'bin/tool.js' }]);
    expect(
      normalizeGlobalBins('test-binless', object(manifests.binless).bin),
    ).toEqual([]);
    expect(
      normalizeGlobalBins('typescript', object(manifests.typescript).bin).map(
        (bin) => bin.name,
      ),
    ).toEqual(['tsc', 'tsserver']);
    expect(object(object(manifests.target).dist).integrity).toBe(
      'sha512-VEVTVC1ub3QtYW4taW50ZWdyaXR5',
    );
  });
  it('records external links and invalid layouts as data without following them', () => {
    const invalid = object(json('links-invalid.json'));
    expect(object(invalid.externalLink).linked).toBe(true);
    expect(object(invalid.unknownPnpmLink).linked).toBe(true);
    expect(Array.isArray(object(invalid.malformedNpm).dependencies)).toBe(true);
    expect(Array.isArray(invalid.malformedPnpm)).toBe(false);
    expect(() =>
      normalizeGlobalBins('test-invalid', object(invalid.invalidManifest).bin),
    ).toThrow();
  });
  it('allows public auth and refuses custom/interpolated registry changes only', () => {
    expect(
      parseGlobalNpmrc(fixture('public-auth.npmrc')).publicAuthPresent,
    ).toBe(true);
    for (const name of [
      'public-auth.npmrc',
      'custom-scoped.npmrc',
      'interpolated.npmrc',
    ]) {
      const input = {
        packageName: '@test/tool',
        action: 'change' as const,
        configs: [fixture(name)],
        environment: {},
        provenanceKnown: true,
      };
      const decision = assessGlobalRegistryPolicy(input);
      expect(decision.changeAllowed).toBe(name === 'public-auth.npmrc');
      expect(JSON.stringify(decision)).not.toContain('TEST-not-a-token');
      expect(
        assessGlobalRegistryPolicy({ ...input, action: 'remove' }).reason,
      ).toBeNull();
    }
  });
});
