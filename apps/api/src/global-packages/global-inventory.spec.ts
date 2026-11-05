import 'reflect-metadata';
import { win32 } from 'node:path';
import {
  parseGlobalInventory,
  readGlobalInventory,
} from '@/global-packages/global-inventory';
import {
  expectGlobalReason,
  memoryFs,
  probeResult,
  TEST_PATHS as P,
  testLocation,
  testSpawn,
} from '@/global-packages/__fixtures__/global-adapters';
import type { GlobalManager } from '@/global-packages/interfaces/global-packages.types';
import { pnpmInventoryFixture } from '@/global-packages/__fixtures__/pnpm11/inventory';

const list = (manager: GlobalManager, dependencies: unknown): unknown =>
  manager === 'npm' ? { dependencies } : [{ path: P.global, dependencies }];

describe('strict bounded global list parsers', () => {
  it.each(['npm', 'pnpm'] as const)(
    'parses only top-level %s packages',
    (manager) => {
      expect(
        parseGlobalInventory(
          manager,
          probeResult(
            list(manager, {
              '@test/tool': {
                version: '1.2.3',
                dependencies: { transitive: { version: '9.0.0' } },
              },
              binless: { version: '2.0.0' },
            }),
          ),
        ),
      ).toEqual([
        { name: '@test/tool', version: '1.2.3', path: null, linked: false },
        { name: 'binless', version: '2.0.0', path: null, linked: false },
      ]);
    },
  );
  it.each(['npm', 'pnpm'] as const)(
    'accepts an explicitly empty %s dependency map',
    (manager) => {
      expect(
        parseGlobalInventory(manager, probeResult(list(manager, {}))),
      ).toEqual([]);
    },
  );
  it.each([{}, { name: 'npm-prefix' }])(
    'accepts an npm root without a dependency map as empty (npm 11 omits it for an empty prefix) %p',
    (value) => {
      expect(parseGlobalInventory('npm', probeResult(value))).toEqual([]);
    },
  );
  it.each([
    ['npm', []],
    ['npm', null],
    ['npm', { error: { code: 'ELSPROBLEMS' } }],
    ['npm', { problems: ['TEST missing'] }],
    ['npm', { dependencies: [] }],
    ['pnpm', {}],
    ['pnpm', []],
    ['pnpm', [{}]],
    ['pnpm', [{ dependencies: {} }, { dependencies: {} }]],
    ['npm', { dependencies: {}, error: { code: 'ELSPROBLEMS' } }],
    ['npm', { dependencies: {}, problems: ['TEST missing'] }],
    ['npm', { dependencies: { tool: { version: '1.0.0', missing: true } } }],
    ['pnpm', [{ dependencies: { tool: { version: '1.0.0', invalid: true } } }]],
    ['npm', { dependencies: { tool: null } }],
    ['npm', { dependencies: { tool: { version: 1 } } }],
    ['npm', { dependencies: { tool: { version: '^1.2.3' } } }],
    ['npm', { dependencies: { tool: { version: 'v1.2.3' } } }],
    ['npm', { dependencies: { TOOL: { version: '1.2.3' } } }],
    ['npm', { dependencies: { '../tool': { version: '1.2.3' } } }],
  ] satisfies [GlobalManager, unknown][])(
    'refuses malformed, unknown or partial %s schema %p',
    async (manager, value) => {
      await expectGlobalReason(
        () => parseGlobalInventory(manager, probeResult(value)),
        'INVENTORY_FAILED',
      );
    },
  );
  it.each(['npm', 'pnpm'] as const)(
    'never returns empty success for nonzero %s exit',
    async (manager) => {
      await expectGlobalReason(
        () =>
          parseGlobalInventory(
            manager,
            probeResult(list(manager, {}), { exitCode: 1 }),
          ),
        'INVENTORY_FAILED',
      );
    },
  );
  it.each([
    Buffer.from('{'),
    Buffer.from(''),
    Buffer.from('{}\n{}'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(
      '{"dependencies":{"tool":{"version":"1.0.0"},"tool":{"version":"2.0.0"}}}',
    ),
  ])(
    'rejects malformed UTF-8, JSON and duplicate package names',
    async (stdout) => {
      await expectGlobalReason(
        () => parseGlobalInventory('npm', probeResult(null, { stdout })),
        'INVENTORY_FAILED',
      );
    },
  );
  it('bounds list capture at 8 MiB', async () => {
    await expectGlobalReason(
      () =>
        parseGlobalInventory(
          'npm',
          probeResult(null, {
            stdout: Buffer.alloc(8 * 1024 * 1024 + 1, 32),
          }),
        ),
      'INVENTORY_FAILED',
    );
  });
  it('rejects JSON deeper than 64 before traversing metadata', async () => {
    let nested: unknown = {};
    for (let index = 0; index < 65; index++) nested = { nested };
    await expectGlobalReason(
      () =>
        parseGlobalInventory('npm', probeResult({ dependencies: {}, nested })),
      'INVENTORY_FAILED',
    );
  });
  it('accepts 10,000 rows but never truncates 10,001', async () => {
    const dependencies = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, i) => [
        `test-${String(i).padStart(5, '0')}`,
        { version: '1.0.0' },
      ]),
    );
    expect(
      parseGlobalInventory('npm', probeResult(list('npm', dependencies))),
    ).toHaveLength(10_000);
    dependencies['test-overflow'] = { version: '1.0.0' };
    await expectGlobalReason(
      () => parseGlobalInventory('npm', probeResult(list('npm', dependencies))),
      'INVENTORY_FAILED',
    );
  });
});

describe('manifest/identity/ownership cross-check', () => {
  function setup(manager: GlobalManager = 'npm') {
    const location = testLocation(manager);
    const memory = memoryFs();
    memory.put(location.globalRoot, { directory: true });
    memory.put(location.binDir, { directory: true });
    const root = win32.join(location.globalRoot, '@test', 'tool');
    const manifest = win32.join(root, 'package.json');
    memory.put(root, { directory: true });
    memory.put(manifest, {
      text: JSON.stringify({
        name: '@test/tool',
        version: '1.2.3',
        bin: { 'test-tool': 'bin/cli.js' },
      }),
    });
    memory.put(win32.join(root, 'bin/cli.js'), {
      text: 'TEST inert executable bytes',
    });
    const spawn = testSpawn().mockResolvedValue(
      probeResult(
        list(manager, {
          '@test/tool': { version: '1.2.3', path: root },
        }),
      ),
    );
    const deps = {
      fs: memory.fs,
      environment: {},
      signal: new AbortController().signal,
      spawn,
    };
    return { ...memory, deps, location, spawn, root, manifest };
  }
  it.each(['npm'] as const)(
    'cross-checks %s list against bounded handle-read manifests',
    async (manager) => {
      const { location, deps, spawn, manifest, open } = setup(manager);
      const result = await readGlobalInventory(location, deps);
      expect(result.packages).toEqual([
        {
          name: '@test/tool',
          version: '1.2.3',
          bins: [{ name: 'test-tool', target: 'bin/cli.js' }],
          status: 'manageable',
          reason: null,
        },
      ]);
      expect(result.facts[0]).toMatchObject({
        name: '@test/tool',
        version: '1.2.3',
      });
      expect(result.facts[0].manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(open).toHaveBeenCalledWith(manifest);
      expect(spawn).toHaveBeenCalledTimes(1);
      const args = spawn.mock.calls[0][1];
      expect(args.slice(-4)).toEqual([
        'list',
        '--global',
        '--depth=0',
        '--json',
      ]);
      expect(args).not.toContain('--global=false');
    },
  );
  it.each(['npm'] as const)(
    'shows an external %s link without reading its manifest',
    async (manager) => {
      const { deps, location, put, root, open } = setup(manager);
      put(root, { link: true, directory: true, real: 'E:\\TEST\\outside' });
      const result = await readGlobalInventory(location, deps);
      expect(result.packages[0]).toMatchObject({
        status: 'linked',
        reason: 'LINKED_PACKAGE',
      });
      expect(result.facts).toEqual([]);
      expect(
        open.mock.calls.some(
          ([path]) => path.startsWith(root) || path.startsWith('E:\\'),
        ),
      ).toBe(false);
    },
  );
  it('cross-checks pnpm 11 group metadata against bounded linked manifests without list spawn', async () => {
    const h = pnpmInventoryFixture();
    const result = await readGlobalInventory(h.location, h.deps);
    expect(result.packages).toEqual([
      {
        name: 'is-number',
        version: '7.0.0',
        bins: [],
        status: 'manageable',
        reason: null,
      },
    ]);
    expect(result.facts[0].manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(h.open).toHaveBeenCalledWith(
      win32.join(h.group.links[0].target, 'package.json'),
    );
    expect(result.pnpmInventory?.groups[0].installDir).toBe(h.group.installDir);
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('shows an external pnpm 11 link without reading its manifest', async () => {
    const h = pnpmInventoryFixture();
    h.put(h.group.links[0].logical, {
      directory: true,
      link: true,
      real: 'E:\\TEST\\outside',
    });
    const result = await readGlobalInventory(h.location, h.deps);
    expect(result.packages[0]).toMatchObject({
      status: 'linked',
      reason: 'LINKED_PACKAGE',
    });
    expect(result.ownershipComplete).toBe(false);
    expect(result.facts).toEqual([]);
    expect(h.open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
      false,
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('keeps an unproven pnpm 11 internal link inert outside the proven store links root', async () => {
    const h = pnpmInventoryFixture();
    const unproven = win32.join(P.global, '.pnpm', 'tool');
    h.put(h.group.links[0].logical, {
      link: true,
      directory: true,
      real: unproven,
    });
    const result = await readGlobalInventory(h.location, h.deps);
    expect(result.packages[0].status).toBe('linked');
    expect(result.ownershipComplete).toBe(false);
    expect(h.open.mock.calls.some(([path]) => path.startsWith(unproven))).toBe(
      false,
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('does not read a list-supplied path outside the global root', async () => {
    const { deps, location, spawn, open } = setup();
    spawn.mockResolvedValue(
      probeResult(
        list('npm', {
          '@test/tool': { version: '1.2.3', path: 'E:\\TEST\\outside' },
        }),
      ),
    );
    await expectGlobalReason(
      () => readGlobalInventory(location, deps),
      'INVENTORY_FAILED',
    );
    expect(open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
      false,
    );
  });
  it.each([
    { name: 'other', version: '1.2.3' },
    { name: '@test/tool', version: '9.0.0' },
    { name: '@test/tool', version: '1.2.3', bin: { tool: '../escape.js' } },
    { name: '@test/tool', version: '1.2.3', bin: { 'tool\n': 'cli.js' } },
  ])(
    'marks mismatched or unsafe manifest invalid: %p',
    async (manifestValue) => {
      const { deps, location, put, manifest } = setup();
      put(manifest, { text: JSON.stringify(manifestValue) });
      const result = await readGlobalInventory(location, deps);
      expect(result.packages[0].status).toBe('invalid');
      expect(result.ownershipComplete).toBe(false);
    },
  );
  it('normalizes scoped string bins and supports binless packages', async () => {
    const { deps, location, put, manifest } = setup();
    put(manifest, {
      text: JSON.stringify({
        name: '@test/tool',
        version: '1.2.3',
        bin: 'bin/cli.js',
      }),
    });
    expect(
      (await readGlobalInventory(location, deps)).packages[0].bins,
    ).toEqual([{ name: 'tool', target: 'bin/cli.js' }]);
    put(manifest, {
      text: JSON.stringify({ name: '@test/tool', version: '1.2.3' }),
    });
    expect(
      (await readGlobalInventory(location, deps)).packages[0].bins,
    ).toEqual([]);
  });
  it('marks a protected current bin as protected', async () => {
    const { deps, location, put, manifest } = setup();
    put(manifest, {
      text: JSON.stringify({
        name: '@test/tool',
        version: '1.2.3',
        bin: { npm: 'bin/cli.js' },
      }),
    });
    expect(
      (await readGlobalInventory(location, deps)).packages[0],
    ).toMatchObject({ status: 'protected', reason: 'PROTECTED_PACKAGE' });
  });
  it('protects an aliased app distribution by canonical path', async () => {
    const { deps, location, root } = setup();
    location.protectedPaths = [...location.protectedPaths, root];
    expect(
      (await readGlobalInventory(location, deps)).packages[0],
    ).toMatchObject({
      status: 'protected',
      reason: 'PROTECTED_PACKAGE',
    });
  });
  it('refuses manifest reads over 1 MiB', async () => {
    const { deps, location, put, manifest } = setup();
    put(manifest, { text: ' '.repeat(1024 * 1024 + 1) });
    await expectGlobalReason(
      () => readGlobalInventory(location, deps),
      'INVENTORY_FAILED',
    );
  });
  it('does not treat invalid manifest UTF-8 as an empty inventory', async () => {
    const { deps, location, put, manifest } = setup();
    put(manifest, { bytes: new Uint8Array([0xc3, 0x28]) });
    await expectGlobalReason(
      () => readGlobalInventory(location, deps),
      'INVENTORY_FAILED',
    );
  });
  it('marks unexplained existing launchers as unknown owners', async () => {
    const { deps, location, readdir, put } = setup();
    readdir.mockResolvedValue(['unowned.cmd']);
    put(win32.join(location.binDir, 'unowned.cmd'), {
      text: 'TEST inert shim',
    });
    const result = await readGlobalInventory(location, deps);
    expect(result.binOwners).toContainEqual({ name: 'unowned', owner: null });
  });
  it('checks cancellation before list or manifest I/O', async () => {
    const { deps, location, spawn, open } = setup();
    const controller = new AbortController();
    controller.abort(new Error('TEST cancel inventory'));
    deps.signal = controller.signal;
    await expect(readGlobalInventory(location, deps)).rejects.toThrow(
      'TEST cancel inventory',
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('bounds aggregate manifest reads at 32 MiB', async () => {
    const { deps, location, spawn, put } = setup();
    const dependencies: Record<string, { version: string; path: string }> = {};
    for (let i = 0; i < 33; i++) {
      const name = `test-large-${i}`;
      const root = win32.join(location.globalRoot, name);
      dependencies[name] = { version: '1.0.0', path: root };
      put(root, { directory: true });
      put(win32.join(root, 'package.json'), {
        text: JSON.stringify({
          name,
          version: '1.0.0',
          description: 'x'.repeat(1024 * 1024 - 200),
        }),
      });
    }
    spawn.mockResolvedValue(probeResult(list('npm', dependencies)));
    await expectGlobalReason(
      () => readGlobalInventory(location, deps),
      'INVENTORY_FAILED',
    );
  });
  it('does not accept a bin target redirected outside the canonical package', async () => {
    const { deps, location, put, root } = setup();
    put(win32.join(root, 'bin/cli.js'), {
      link: true,
      real: 'E:\\TEST\\outside.js',
    });
    const result = await readGlobalInventory(location, deps);
    expect(result.packages[0].status).toBe('invalid');
    expect(result.ownershipComplete).toBe(false);
  });
  it('treats a missing listed package as a failed inventory, never empty success', async () => {
    const { deps, location, entries, root } = setup();
    entries.delete(win32.resolve(root).toLowerCase());
    await expectGlobalReason(
      () => readGlobalInventory(location, deps),
      'INVENTORY_FAILED',
    );
  });
});
