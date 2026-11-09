import 'reflect-metadata';
import { win32 } from 'node:path';
import { readPnpmGlobalInventory } from '@/global-packages/discovery/pnpm-global-inventory';
import { expectGlobalReason } from '@/global-packages/__fixtures__/global-adapters';
import { PNPM_TEST_PATHS as Q } from '@/global-packages/__fixtures__/pnpm11/facts';
import { pnpmInventoryFixture } from '@/global-packages/__fixtures__/pnpm11/inventory';
import { pnpmNodeShims } from '@/global-packages/__fixtures__/pnpm11/shims';

describe('pnpm 11 static install groups and ownership', () => {
  function cliFixture() {
    const h = pnpmInventoryFixture();
    h.entries.clear();
    h.put(Q.bin, { directory: true });
    const group = h.addGroup({ 'test-cli': '1.0.0' });
    const link = group.links[0];
    h.put(win32.join(link.target, 'package.json'), {
      text: JSON.stringify({
        name: 'test-cli',
        version: '1.0.0',
        bin: { 'test-cli': 'bin/cli.js' },
      }),
    });
    h.put(win32.join(link.target, 'bin', 'cli.js'), {
      text: 'TEST inert bin bytes',
    });
    // Inert source-derived invocation forms, not observed RT0b shim bytes.
    for (const directory of [Q.bin, win32.join(group.modulesDir, '.bin')]) {
      const target = win32.join(
        directory === Q.bin ? group.index : group.installDir,
        'node_modules',
        'test-cli',
        'bin',
        'cli.js',
      );
      h.put(win32.join(directory, 'test-cli'), {
        text: `#!/bin/sh\nexec node "${target}" "$@"\n`,
      });
      h.put(win32.join(directory, 'test-cli.cmd'), {
        text: `@ECHO off\r\nnode "${target}" %*\r\n`,
      });
      h.put(win32.join(directory, 'test-cli.ps1'), {
        text: `& node "${target}" $args\n`,
      });
    }
    return { ...h, group, link };
  }

  it.each([false, true])(
    'accepts source-derived pnpm Node shim control flow (pinned executable=%s)',
    async (pinned) => {
      const h = cliFixture();
      for (const directory of [Q.bin, win32.join(h.group.modulesDir, '.bin')]) {
        const target = win32.join(
          directory === Q.bin ? h.group.index : h.group.installDir,
          'node_modules',
          'test-cli',
          'bin',
          'cli.js',
        );
        for (const [extension, text] of Object.entries(
          pnpmNodeShims(
            target,
            directory,
            pinned ? h.location.tool.file : undefined,
          ),
        ))
          h.put(win32.join(directory, `test-cli${extension}`), { text });
      }
      const result = await readPnpmGlobalInventory(h.location, h.deps);
      expect(result.packages[0]).toMatchObject({
        status: 'manageable',
        reason: null,
      });
      expect(result.binOwners).toContainEqual({
        name: 'test-cli',
        owner: 'test-cli',
      });
      expect(result.ownershipComplete).toBe(true);
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      '.cmd',
      (target: string) =>
        `#not-a-cmd-comment & node "E:\\TEST\\foreign.js"\r\nnode "${target}" %*\r\n`,
    ],
    [
      '.ps1',
      (target: string) =>
        `::not-a-pwsh-comment; & node "E:\\TEST\\foreign.js"\n& node "${target}" $args\n`,
    ],
    [
      '',
      (target: string) =>
        `::not-a-sh-comment; node "E:\\TEST\\foreign.js"\nexec node "${target}" "$@"\n`,
    ],
    ['.cmd', (target: string) => `node"${target}" %*\r\n`],
    ['.ps1', (target: string) => `& node"${target}" $args\n`],
    ['', (target: string) => `exec node"${target}" "$@"\n`],
    [
      '.cmd',
      (target: string) =>
        `@ECHO off\r\nnode "E:\\TEST\\foreign.js" "${target}" %*\r\n`,
    ],
    [
      '.ps1',
      (target: string) => `& node "E:\\TEST\\foreign.js" "${target}" $args\n`,
    ],
    [
      '',
      (target: string) =>
        `#!/bin/sh\nexec node "E:\\TEST\\foreign.js" "${target}" "$@"\n`,
    ],
    [
      '.cmd',
      (target: string) =>
        `@ECHO off\r\nnode "${target}" %* & node "E:\\TEST\\foreign.js"\r\n`,
    ],
    [
      '.ps1',
      (target: string) =>
        `& node "${target}" $args; & node "E:\\TEST\\foreign.js"\n`,
    ],
    [
      '',
      (target: string) =>
        `#!/bin/sh\nexec node "${target}" "$@"; node "E:\\TEST\\foreign.js"\n`,
    ],
    [
      '.cmd',
      (target: string) => `node "${target}" %*\r\nnode "${target}" %*\r\n`,
    ],
    [
      '.ps1',
      (target: string) =>
        `& node "${target}" $args\n& node "${target}" $args\n`,
    ],
    [
      '',
      (target: string) =>
        `#!/bin/sh\nexec node "${target}" "$@"\nexec node "${target}" "$@"\n`,
    ],
    ['.cmd', (target: string) => `"E:\\TEST\\foreign.exe" "${target}" %*\r\n`],
    [
      '.ps1',
      (target: string) => `& "E:\\TEST\\foreign.exe" "${target}" $args\n`,
    ],
    [
      '',
      (target: string) =>
        `#!/bin/sh\nexec "E:\\TEST\\foreign" "${target}" "$@"\n`,
    ],
  ] satisfies [string, (target: string) => string][])(
    'rejects adversarial %s shim executable/script positions and extra invocations %#',
    async (extension, render) => {
      const h = cliFixture();
      const target = win32.join(
        h.group.index,
        'node_modules',
        'test-cli',
        'bin',
        'cli.js',
      );
      h.put(win32.join(Q.bin, `test-cli${extension}`), {
        text: render(target),
      });
      const result = await readPnpmGlobalInventory(h.location, h.deps);
      expect(result.binOwners).toContainEqual({
        name: 'test-cli',
        owner: null,
      });
      expect(result.packages[0]).toMatchObject({
        status: 'invalid',
        reason: 'BIN_CONFLICT',
      });
      expect(result.ownershipComplete).toBe(false);
      expect(h.open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
        false,
      );
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it.each(['group', 'package', 'package-map'] as const)(
    'refuses YAML-only syntax in a %s JSON file (review F2)',
    async (kind) => {
      const h = pnpmInventoryFixture();
      const path =
        kind === 'group'
          ? win32.join(h.group.installDir, 'package.json')
          : kind === 'package'
            ? win32.join(h.group.links[0].target, 'package.json')
            : win32.join(h.group.modulesDir, '.package-map.json');
      const text =
        kind === 'group'
          ? 'dependencies:\n  is-number: 7.0.0\n'
          : kind === 'package'
            ? 'name: is-number\nversion: 7.0.0\n'
            : 'packages:\n  .:\n    url: ../\n    dependencies: {is-number: is-number@7.0.0}\n  is-number@7.0.0:\n    url: "' +
              win32
                .relative(h.group.modulesDir, h.group.links[0].target)
                .replace(/\\/g, '/') +
              '/"\n    dependencies: {is-number: is-number@7.0.0}\n';
      h.put(path, { text });
      await expectGlobalReason(
        () => readPnpmGlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{'dependencies': {'is-number': '7.0.0'}}",
    '{"dependencies":{"is-number":"7.0.0",}}',
    '{/* TEST comment */"dependencies":{"is-number":"7.0.0"}}',
    '{"dependencies":{"is-number":"7.0.0","is-number":"7.0.0"}}',
    '{"dependencies":{"is-number":"7.0.0","is-\\u006eumber":"7.0.0"}}',
  ])(
    'rejects non-JSON grammar and duplicate decoded keys %s (review F2)',
    async (text) => {
      const h = pnpmInventoryFixture();
      h.put(win32.join(h.group.installDir, 'package.json'), { text });
      await expectGlobalReason(
        () => readPnpmGlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
    },
  );

  it.each([
    'abc-1a1aa104925-e77952ba3460596d',
    '10000-1a1aa104925-e77952ba3460596d',
    '1-1-e77952ba3460596d',
    'ffffffff-1fffffffffffff-e77952ba3460596d',
  ])(
    'accepts variable-width pnpm PID/time install name %s (review F3)',
    async (name) => {
      const h = pnpmInventoryFixture();
      h.entries.clear();
      h.put(Q.bin, { directory: true });
      const group = h.addGroup({ 'is-number': '7.0.0' }, name);
      const result = await readPnpmGlobalInventory(h.location, h.deps);
      expect(result.packages).toEqual([
        {
          name: 'is-number',
          version: '7.0.0',
          bins: [],
          status: 'manageable',
          reason: null,
        },
      ]);
      expect(result.ownershipComplete).toBe(true);
      expect(result.pnpmInventory!.groups[0].installDir).toBe(group.installDir);
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it.each(['pnpm@11.21.0', 'pnpm@11.0.0'])(
    'keeps compatible %s layout manageable after upgrading the running tool (review F4)',
    async (manager) => {
      const h = pnpmInventoryFixture();
      h.put(win32.join(h.group.modulesDir, '.modules.yaml'), {
        text: JSON.stringify({
          layoutVersion: 5,
          packageManager: manager,
          nodeLinker: 'isolated',
          storeDir: Q.store,
          virtualStoreDir: win32.join(Q.store, 'links'),
        }),
      });
      const result = await readPnpmGlobalInventory(h.location, h.deps);
      expect(result.packages[0]).toMatchObject({
        status: 'manageable',
        reason: null,
      });
      expect(result.ownershipComplete).toBe(true);
      expect(h.location.tool.version).toBe('11.22.0');
      expect(result.pnpmInventory!.groups[0].modules.sha256).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['pnpm@10.30.0', 5],
    ['pnpm@12.0.0', 5],
    ['npm@11.22.0', 5],
    ['pnpm@11.invalid', 5],
    ['pnpm@11.21.0', 6],
    ['pnpm@11.21.0', null],
  ] satisfies [string, number | null][])(
    'refuses incompatible manager/layout %s/%s after upgrade (review F4)',
    async (manager, layout) => {
      const h = pnpmInventoryFixture();
      h.put(win32.join(h.group.modulesDir, '.modules.yaml'), {
        text: JSON.stringify({
          layoutVersion: layout,
          packageManager: manager,
          nodeLinker: 'isolated',
          storeDir: Q.store,
          virtualStoreDir: win32.join(Q.store, 'links'),
        }),
      });
      const result = await readPnpmGlobalInventory(h.location, h.deps);
      expect(result.packages[0].status).not.toBe('manageable');
      expect(result.ownershipComplete).toBe(false);
      expect(
        h.open.mock.calls.some(([path]) =>
          path.startsWith(h.group.links[0].target),
        ),
      ).toBe(false);
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it('derives bins from the proven linked manifest and pins both group and global shims as inert data', async () => {
    const h = cliFixture();
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages).toEqual([
      {
        name: 'test-cli',
        version: '1.0.0',
        bins: [{ name: 'test-cli', target: 'bin/cli.js' }],
        status: 'manageable',
        reason: null,
      },
    ]);
    expect(result.binOwners).toContainEqual({
      name: 'test-cli',
      owner: 'test-cli',
    });
    expect(result.ownershipComplete).toBe(true);
    for (const directory of [Q.bin, win32.join(h.group.modulesDir, '.bin')]) {
      for (const extension of ['', '.cmd', '.ps1']) {
        expect(result.facts[0].binIdentities).toContainEqual(
          expect.objectContaining({
            path: win32.join(directory, `test-cli${extension}`),
          }),
        );
      }
    }
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('marks an unexplained global shim owner unknown and blocks its package', async () => {
    const h = cliFixture();
    h.put(win32.join(Q.bin, 'test-cli.cmd'), {
      text: '@ECHO off\r\nnode "E:\\TEST\\outside.js" %*\r\n',
    });
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.binOwners).toContainEqual({ name: 'test-cli', owner: null });
    expect(result.packages[0]).toMatchObject({
      status: 'invalid',
      reason: 'BIN_CONFLICT',
    });
    expect(result.ownershipComplete).toBe(false);
    expect(h.open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
      false,
    );
  });

  it('caps shim reads at 64 KiB instead of accepting a truncated launcher', async () => {
    const h = cliFixture();
    const shim = win32.join(Q.bin, 'test-cli.cmd');
    h.put(shim, { text: 'x'.repeat(64 * 1024 + 1) });
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.open.mock.calls.some(([path]) => path === shim)).toBe(false);
  });

  it('never reads a bin target redirected outside its proven package', async () => {
    const h = cliFixture();
    h.put(win32.join(h.link.target, 'bin', 'cli.js'), {
      link: true,
      real: 'E:\\TEST\\outside.js',
    });
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages[0].status).toBe('invalid');
    expect(result.ownershipComplete).toBe(false);
    expect(h.open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
      false,
    );
  });
  it('reads one direct dependency per indexed install and pins all metadata and links', async () => {
    const h = pnpmInventoryFixture();
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages).toEqual([
      {
        name: 'is-number',
        version: '7.0.0',
        bins: [],
        status: 'manageable',
        reason: null,
      },
    ]);
    expect(result.ownershipComplete).toBe(true);
    expect(result.pnpmInventory).toMatchObject({
      ownershipComplete: true,
      unreferencedDirectories: [],
    });
    expect(result.pnpmInventory?.groups).toHaveLength(1);
    const group = result.pnpmInventory!.groups[0];
    expect(group).toMatchObject({
      installDir: h.group.installDir,
      directDependencies: ['is-number'],
      storeDir: Q.store,
      virtualStoreDir: win32.join(Q.store, 'links'),
      index: { logicalPath: h.group.index, realPath: h.group.installDir },
      packageLinks: [
        {
          logicalPath: h.group.links[0].logical,
          realPath: h.group.links[0].target,
        },
      ],
    });
    for (const metadata of [
      group.manifest,
      group.lockfile,
      group.modules,
      group.packageMap,
      group.virtualStoreLockfile,
    ]) {
      expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(h.open).toHaveBeenCalledWith(metadata.file.path);
    }
    expect(result.facts[0].pnpmGroup).toEqual(group);
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.readFile).not.toHaveBeenCalled();
  });

  it('resolves source-derived scoped name segments inside the configured store', async () => {
    const h = pnpmInventoryFixture();
    h.entries.clear();
    h.put(Q.bin, { directory: true });
    const group = h.addGroup({ '@test/tool': '1.2.3' });
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages).toEqual([
      {
        name: '@test/tool',
        version: '1.2.3',
        bins: [],
        status: 'manageable',
        reason: null,
      },
    ]);
    expect(group.links[0].logical).toBe(
      win32.join(group.modulesDir, '@test', 'tool'),
    );
    expect(h.open).toHaveBeenCalledWith(
      win32.join(group.links[0].target, 'package.json'),
    );
  });

  it('makes every direct dependency of a multi-package group readonly', async () => {
    const h = pnpmInventoryFixture();
    h.addGroup({ 'is-number': '7.0.0', 'is-odd': '3.0.1' });
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages).toHaveLength(2);
    expect(result.packages.map(({ name }) => name).sort()).toEqual([
      'is-number',
      'is-odd',
    ]);
    for (const row of result.packages) {
      expect(row.status).not.toBe('manageable');
      expect(row.reason).toBe('GLOBAL_GROUP_UNSUPPORTED');
    }
  });

  it('refuses duplicate ownership across two indexed install dirs', async () => {
    const h = pnpmInventoryFixture();
    h.addGroup(
      { 'is-number': '7.0.0' },
      '81fd-1a1aa104926-e77952ba3460596e',
      'c'.repeat(64),
    );
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages.length).toBeGreaterThan(0);
    expect(result.packages.every((row) => row.status !== 'manageable')).toBe(
      true,
    );
    expect(result.ownershipComplete).toBe(false);
  });

  it('pins unreferenced physical installs without reporting them as installed packages', async () => {
    const h = pnpmInventoryFixture();
    h.entries.delete(h.group.index.toLowerCase());
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages).toEqual([]);
    expect(result.pnpmInventory?.unreferencedDirectories).toEqual([
      expect.objectContaining({ path: h.group.installDir }),
    ]);
    expect(h.open).not.toHaveBeenCalled();
  });

  it('accepts a captured missing root as empty without enumeration or spawn', async () => {
    const h = pnpmInventoryFixture();
    h.entries.clear();
    h.put(Q.bin, { directory: true });
    h.location.pnpm!.missingDirectoryPaths = [Q.root];
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages).toEqual([]);
    expect(result.ownershipComplete).toBe(true);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it.each(['external-index', 'broken-index', 'nested-install'] as const)(
    'refuses incomplete ownership from %s without reading its destination',
    async (kind) => {
      const h = pnpmInventoryFixture();
      const outside =
        kind === 'external-index'
          ? 'E:\\TEST\\outside'
          : win32.join(Q.root, 'nested', 'install');
      h.put(h.group.index, { link: true, directory: true, real: outside });
      if (kind === 'broken-index')
        h.realpath.mockImplementation((path) => {
          if (path.toLowerCase() === h.group.index.toLowerCase())
            return Promise.reject(
              Object.assign(new Error('TEST broken index'), { code: 'ENOENT' }),
            );
          return Promise.resolve(
            h.entries.get(path.toLowerCase())?.real ?? path,
          );
        });
      const result = await readPnpmGlobalInventory(h.location, h.deps);
      expect(result.ownershipComplete).toBe(false);
      expect(h.open.mock.calls.some(([path]) => path.startsWith(outside))).toBe(
        false,
      );
    },
  );

  it('keeps a broken package link readonly and never opens its missing manifest', async () => {
    const h = pnpmInventoryFixture();
    h.entries.delete(h.group.links[0].target.toLowerCase());
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.packages[0].status).not.toBe('manageable');
    expect(result.ownershipComplete).toBe(false);
    expect(
      h.open.mock.calls.some(
        ([path]) =>
          path === win32.join(h.group.links[0].target, 'package.json'),
      ),
    ).toBe(false);
  });

  it.each([
    'pnpm-lock.yaml',
    'node_modules/.modules.yaml',
    'node_modules/.package-map.json',
    'node_modules/.pnpm/lock.yaml',
  ])('never treats corrupt %s as empty success', async (file) => {
    const h = pnpmInventoryFixture();
    h.put(win32.join(h.group.installDir, file), { text: '{' });
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it.each(['name', 'version'] as const)(
    'refuses linked manifest %s disagreement',
    async (field) => {
      const h = pnpmInventoryFixture();
      h.put(win32.join(h.group.links[0].target, 'package.json'), {
        text: JSON.stringify({
          name: 'is-number',
          version: '7.0.0',
          [field]: field === 'name' ? 'other' : '9.0.0',
        }),
      });
      const result = await readPnpmGlobalInventory(h.location, h.deps);
      expect(result.packages[0].status).toBe('invalid');
      expect(result.ownershipComplete).toBe(false);
    },
  );

  it.each(['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'])(
    'refuses %s that disagrees with group dependencies and the installed manifest',
    async (file) => {
      const h = pnpmInventoryFixture();
      h.put(win32.join(h.group.installDir, file), {
        text: JSON.stringify({
          lockfileVersion: '9.0',
          importers: {
            '.': {
              dependencies: {
                'is-number': { specifier: '7.0.0', version: '9.0.0' },
              },
            },
          },
          packages: { 'is-number@9.0.0': {} },
          snapshots: { 'is-number@9.0.0': {} },
        }),
      });
      await expectGlobalReason(
        () => readPnpmGlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
    },
  );

  it('refuses a package map that redirects the direct dependency elsewhere without opening it', async () => {
    const h = pnpmInventoryFixture();
    h.put(win32.join(h.group.modulesDir, '.package-map.json'), {
      text: JSON.stringify({
        packages: {
          '.': { url: '../', dependencies: { 'is-number': 'is-number@7.0.0' } },
          'is-number@7.0.0': {
            url: 'file:///E:/TEST/outside/',
            dependencies: {},
          },
        },
      }),
    });
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
      false,
    );
  });

  it('never infers a cross-volume default store from PNPM_HOME', async () => {
    const h = pnpmInventoryFixture();
    h.location.storeDir = null;
    h.location.pnpm!.storeDir = null;
    h.put(win32.join(h.group.modulesDir, '.modules.yaml'), {
      text: JSON.stringify({
        storeDir: 'E:\\TEST\\unproven-store\\v11',
        virtualStoreDir: 'E:\\TEST\\unproven-store\\v11\\links',
      }),
    });
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.ownershipComplete).toBe(false);
    expect(result.packages.every((row) => row.status !== 'manageable')).toBe(
      true,
    );
    expect(h.open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
      false,
    );
  });

  it('rejects oversized manifests before handle reads and never returns partial empty data', async () => {
    const h = pnpmInventoryFixture();
    const manifest = win32.join(h.group.links[0].target, 'package.json');
    h.put(manifest, { text: ' '.repeat(1024 * 1024 + 1) });
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.open.mock.calls.some(([path]) => path === manifest)).toBe(false);
  });

  it('refuses more than 40,000 entries rather than truncating', async () => {
    const h = pnpmInventoryFixture();
    h.readdir.mockResolvedValue(
      Array.from({ length: 40_001 }, (_, i) => `test-${i}`),
    );
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });

  it('honors cancellation before any filesystem access', async () => {
    const h = pnpmInventoryFixture();
    h.controller.abort(new Error('TEST cancelled inventory'));
    await expect(readPnpmGlobalInventory(h.location, h.deps)).rejects.toThrow(
      'TEST cancelled inventory',
    );
    expect(h.lstat).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('does not turn root permission failures into an empty inventory', async () => {
    const h = pnpmInventoryFixture();
    h.readdir.mockRejectedValue(
      Object.assign(new Error('TEST denied'), { code: 'EACCES' }),
    );
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });

  it('refuses more than 10,000 direct rows without truncation', async () => {
    const h = pnpmInventoryFixture();
    const dependencies = Object.fromEntries(
      Array.from({ length: 10_001 }, (_, i) => [`test-${i}`, '1.0.0']),
    );
    h.addGroup(dependencies);
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });

  it('bounds aggregate metadata and manifest reads at 32 MiB', async () => {
    const h = pnpmInventoryFixture();
    const group = h.addGroup(
      Object.fromEntries(
        Array.from({ length: 33 }, (_, i) => [`test-${i}`, '1.0.0']),
      ),
    );
    for (const link of group.links)
      h.put(win32.join(link.target, 'package.json'), {
        text: JSON.stringify({
          name: link.name,
          version: link.version,
          description: 'x'.repeat(1024 * 1024 - 200),
        }),
      });
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });

  it('bounds JSON and YAML depth at 64', async () => {
    const h = pnpmInventoryFixture();
    let nested: unknown = {};
    for (let i = 0; i < 65; i++) nested = { nested };
    h.put(win32.join(h.group.installDir, 'package.json'), {
      text: JSON.stringify({ dependencies: { 'is-number': '7.0.0' }, nested }),
    });
    await expectGlobalReason(
      () => readPnpmGlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });

  it('yields during large inventories so event-loop cancellation can stop work', async () => {
    const h = pnpmInventoryFixture();
    h.addGroup(
      Object.fromEntries(
        Array.from({ length: 256 }, (_, i) => [`test-${i}`, '1.0.0']),
      ),
    );
    const cancellation = new Promise<void>((resolve) =>
      setImmediate(() => {
        h.controller.abort(new Error('TEST event-loop cancellation'));
        resolve();
      }),
    );
    await expect(readPnpmGlobalInventory(h.location, h.deps)).rejects.toThrow(
      'TEST event-loop cancellation',
    );
    await cancellation;
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('stops after an abort at a filesystem await boundary', async () => {
    const h = pnpmInventoryFixture();
    const original = h.readdir.getMockImplementation()!;
    h.readdir.mockImplementationOnce((path) => {
      h.controller.abort(new Error('TEST aborted after readdir'));
      return original(path);
    });
    await expect(readPnpmGlobalInventory(h.location, h.deps)).rejects.toThrow(
      'TEST aborted after readdir',
    );
    expect(h.open).not.toHaveBeenCalled();
  });

  it('refuses redirected store ancestors before opening a package manifest', async () => {
    const h = pnpmInventoryFixture();
    const links = win32.join(Q.store, 'links');
    h.put(links, { directory: true, link: true, real: 'E:\\TEST\\outside' });
    const result = await readPnpmGlobalInventory(h.location, h.deps);
    expect(result.ownershipComplete).toBe(false);
    expect(result.packages[0].status).not.toBe('manageable');
    expect(
      h.open.mock.calls.some(
        ([path]) =>
          path.startsWith(h.group.links[0].target) || path.startsWith('E:\\'),
      ),
    ).toBe(false);
  });
});
