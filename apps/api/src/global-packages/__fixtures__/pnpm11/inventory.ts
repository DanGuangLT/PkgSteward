import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import type { IGlobalInventoryDeps } from '@/global-packages/discovery/global-inventory';
import type { IGlobalPreviewFacts } from '@/global-packages/interfaces/global-packages.runtime';
import type { IPnpmGlobalGroupFacts } from '@/global-packages/interfaces/pnpm-global.types';
import {
  memoryFs,
  testSpawn,
} from '@/global-packages/__fixtures__/global-adapters';
import {
  testConfigIdentity,
  testIdentity,
} from '@/global-packages/__fixtures__/global-lifecycle';
import {
  PNPM_TEST_PATHS as Q,
  pnpmLocation,
} from '@/global-packages/__fixtures__/pnpm11/facts';

// TEST không phải yêu cầu nghiệp vụ. RT0b-shaped data; no host filesystem IO.
// Scoped paths are SOURCE-DERIVED, not observed: pnpm 11.22.0 bundle
// safeJoinModulesDir:175598-175607 and getGlobalPackageDetails:191958-191966.
export const PNPM_INSTALL = '81fc-1a1aa104925-e77952ba3460596d';
export const PNPM_INDEX = 'a'.repeat(64);
const key = (path: string): string => win32.resolve(path).toLowerCase();

export function pnpmInventoryFixture() {
  const memory = memoryFs();
  const location = pnpmLocation();
  const spawn = testSpawn();
  const controller = new AbortController();
  const readdir = jest.fn<Promise<readonly string[]>, [string]>();
  readdir.mockImplementation((path) => {
    const parent = key(path);
    const names = [...memory.entries.keys()]
      .filter(
        (entry) => key(win32.dirname(entry)) === parent && entry !== parent,
      )
      .map((entry) => win32.basename(entry));
    return Promise.resolve(names);
  });
  const fs = Object.assign(memory.fs, { readdir });
  const deps: IGlobalInventoryDeps = {
    fs,
    environment: {},
    signal: controller.signal,
    spawn,
  };
  for (const path of [Q.root, Q.bin, Q.store])
    memory.put(path, { directory: true });

  function addGroup(
    dependencies: Readonly<Record<string, string>> = { 'is-number': '7.0.0' },
    installName = PNPM_INSTALL,
    indexName = PNPM_INDEX,
  ) {
    const installDir = win32.join(Q.root, installName);
    const index = win32.join(Q.root, indexName);
    const modulesDir = win32.join(installDir, 'node_modules');
    memory.put(installDir, { directory: true });
    memory.put(index, { directory: true, link: true, real: installDir });
    memory.put(win32.join(installDir, 'package.json'), {
      text: JSON.stringify({ dependencies }),
    });
    const locked = Object.fromEntries(
      Object.entries(dependencies).map(([name, version]) => [
        name,
        { specifier: version, version },
      ]),
    );
    const lock = JSON.stringify({
      lockfileVersion: '9.0',
      settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
      importers: { '.': { dependencies: locked } },
      packages: Object.fromEntries(
        Object.entries(dependencies).map(([name, version]) => [
          `${name}@${version}`,
          { resolution: { integrity: 'sha512-VEVTVC1pbmVydA==' } },
        ]),
      ),
      snapshots: Object.fromEntries(
        Object.entries(dependencies).map(([name, version]) => [
          `${name}@${version}`,
          {},
        ]),
      ),
    });
    memory.put(win32.join(installDir, 'pnpm-lock.yaml'), { text: lock });
    memory.put(win32.join(modulesDir, '.pnpm', 'lock.yaml'), { text: lock });
    memory.put(win32.join(modulesDir, '.modules.yaml'), {
      text: JSON.stringify({
        layoutVersion: 5,
        packageManager: 'pnpm@11.22.0',
        nodeLinker: 'isolated',
        storeDir: Q.store,
        virtualStoreDir: win32.join(Q.store, 'links'),
        virtualStoreDirMaxLength: 60,
        included: {
          dependencies: true,
          devDependencies: true,
          optionalDependencies: true,
        },
        pendingBuilds: [],
        skipped: [],
      }),
    });
    const links = Object.entries(dependencies).map(([name, version]) => {
      const hash = createHash('sha256')
        .update(`${name}@${version}`)
        .digest('hex');
      const target = win32.join(
        Q.store,
        'links',
        '@',
        ...name.split('/'),
        version,
        hash,
        'node_modules',
        ...name.split('/'),
      );
      const logical = win32.join(modulesDir, ...name.split('/'));
      memory.put(target, { directory: true });
      memory.put(logical, { directory: true, link: true, real: target });
      memory.put(win32.join(target, 'package.json'), {
        text: JSON.stringify({ name, version }),
      });
      return { name, version, logical, target };
    });
    // SOURCE-DERIVED package-map shape: packageMap.js:205810-205841.
    memory.put(win32.join(modulesDir, '.package-map.json'), {
      text: JSON.stringify({
        packages: {
          '.': {
            url: '../',
            dependencies: Object.fromEntries(
              links.map(({ name, version }) => [name, `${name}@${version}`]),
            ),
          },
          ...Object.fromEntries(
            links.map(({ name, version, target }) => [
              `${name}@${version}`,
              {
                url: `${win32.relative(modulesDir, target).replace(/\\/g, '/')}/`,
                dependencies: { [name]: `${name}@${version}` },
              },
            ]),
          ),
        },
      }),
    });
    return { index, installDir, modulesDir, links };
  }
  const group = addGroup();
  return {
    ...memory,
    location,
    deps,
    spawn,
    controller,
    readdir,
    group,
    addGroup,
  };
}

export function pnpmPreviewFacts(): IGlobalPreviewFacts {
  const location = pnpmLocation();
  const installDir = win32.join(Q.root, PNPM_INSTALL);
  const modules = win32.join(installDir, 'node_modules');
  const logical = win32.join(modules, 'is-number');
  const real = win32.join(
    Q.store,
    'links',
    '@',
    'is-number',
    '7.0.0',
    'b'.repeat(64),
    'node_modules',
    'is-number',
  );
  const group: IPnpmGlobalGroupFacts = {
    index: {
      logicalPath: win32.join(Q.root, PNPM_INDEX),
      realPath: installDir,
      identity: testIdentity(win32.join(Q.root, PNPM_INDEX)),
    },
    installDir,
    directory: testIdentity(installDir),
    manifest: testConfigIdentity(win32.join(installDir, 'package.json')),
    lockfile: testConfigIdentity(win32.join(installDir, 'pnpm-lock.yaml')),
    modules: testConfigIdentity(win32.join(modules, '.modules.yaml')),
    packageMap: testConfigIdentity(win32.join(modules, '.package-map.json')),
    virtualStoreLockfile: testConfigIdentity(
      win32.join(modules, '.pnpm', 'lock.yaml'),
    ),
    directDependencies: ['is-number'],
    packageLinks: [
      { logicalPath: logical, realPath: real, identity: testIdentity(logical) },
    ],
    storeDir: Q.store,
    virtualStoreDir: win32.join(Q.store, 'links'),
  };
  location.pnpm!.configIdentities = [testConfigIdentity(Q.yaml)];
  location.pnpm!.directoryIdentities = [
    testIdentity(Q.root),
    testIdentity(Q.bin),
  ];
  location.pnpm!.missingConfigPaths = [win32.join(Q.config, 'auth.ini')];
  location.pnpm!.missingDirectoryPaths = [Q.cache];
  location.configIdentities = [...location.pnpm!.configIdentities];
  return {
    location,
    current: {
      name: 'is-number',
      version: '7.0.0',
      packageRoot: real,
      manifest: testConfigIdentity(win32.join(real, 'package.json')),
      bins: [],
      binIdentities: [testIdentity(win32.join(Q.bin, 'test-tool.cmd'))],
      pnpmGroup: group,
    },
    target: null,
    binOwners: [],
    pnpmInventory: {
      groups: [group],
      unreferencedDirectories: [],
      ownershipComplete: true,
      shimIdentities: [testConfigIdentity(win32.join(Q.bin, 'test-tool.cmd'))],
    },
  };
}

// Plain retained stat data; avoids using the product snapshotter to derive expectations.
export function plainPnpmPreviewFacts(): IGlobalPreviewFacts {
  return JSON.parse(JSON.stringify(pnpmPreviewFacts())) as IGlobalPreviewFacts;
}
