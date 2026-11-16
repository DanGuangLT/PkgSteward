import 'reflect-metadata';
import { win32 } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  readPnpm10GlobalInventory,
  pnpm10DepPathToFilename,
} from './pnpm10-global-inventory';
import {
  pnpm10BinlessFixture,
  pnpm10InventoryFixture,
  pnpm10PrivateHoistFixture,
} from '../__fixtures__/pnpm10/inventory';
import { P10 } from '../__fixtures__/pnpm10/config';
import { expectGlobalReason } from '../__fixtures__/global-adapters';
import { assertGlobalPackageMutable } from '../policy/global-policy';

type HoistFixture = Awaited<ReturnType<typeof pnpm10PrivateHoistFixture>>;
function rewriteHoistModules(
  h: HoistFixture,
  edit: (data: Record<string, unknown>) => void,
) {
  const path = win32.join(P10.root, 'node_modules/.modules.yaml');
  const data = JSON.parse(h.entries.get(path.toLowerCase())!.text!) as Record<
    string,
    unknown
  >;
  edit(data);
  h.put(path, { text: JSON.stringify(data) });
}

describe('pnpm 10 static direct-dependency inventory', () => {
  it('proves eight private registry hoists as ancillary with exactly two manageable direct rows', async () => {
    const h = await pnpm10PrivateHoistFixture();
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toMatchObject([
      { name: 'cliui', version: '8.0.1', status: 'manageable' },
      { name: 'wrap-ansi', version: '7.0.0', status: 'manageable' },
    ]);
    expect(r.packages).toHaveLength(2);
    expect(r.facts).toHaveLength(2);
    expect(r.pnpm10Inventory?.project.dependencies).toHaveLength(2);
    expect(r.ownershipComplete).toBe(true);
    expect(r.binOwners.every((bin) => bin.owner === null)).toBe(true);
    const project = r.pnpm10Inventory!.project;
    expect(
      project.ancillary.find(
        (a) =>
          a.identity.path === `${P10.root}\\.pnpm\\node_modules\\string-width`,
      )?.realPath,
    ).toBe(
      `${P10.root}\\.pnpm\\string-width@4.2.3\\node_modules\\string-width`,
    );
    expect(
      project.files.find(
        (f) =>
          f.file.path ===
          `${P10.root}\\.pnpm\\string-width@4.2.3\\node_modules\\string-width\\package.json`,
      )?.sha256,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('proves canonical scoped private hoists without adding direct rows or bin owners', async () => {
    const h = await pnpm10PrivateHoistFixture(true);
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages.map((p) => p.name)).toEqual(['cliui', 'wrap-ansi']);
    expect(
      r.pnpm10Inventory?.project.ancillary.find(
        (a) =>
          a.identity.path === `${P10.root}\\.pnpm\\node_modules\\@test\\tool`,
      )?.realPath,
    ).toBe(`${P10.root}\\.pnpm\\@test+tool@1.0.0\\node_modules\\@test\\tool`);
    expect(r.ownershipComplete).toBe(true);
    expect(r.binOwners.every((bin) => bin.owner === null)).toBe(true);
  });
  it.each([null, [], 'private', 1])(
    'refuses non-map hoist metadata %p',
    async (value) => {
      const h = await pnpm10PrivateHoistFixture();
      rewriteHoistModules(h, (m) => {
        m.hoistedDependencies = value;
      });
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
    },
  );
  it.each([
    null,
    [],
    'private',
    {},
    { 'string-width': 'public' },
    { 'string-width': { private: true } },
    { alias: 'private' },
    { 'string-width': 'private', alias: 'private' },
  ])(
    'refuses malformed/private-public/ambiguous aliases %p',
    async (aliases) => {
      const h = await pnpm10PrivateHoistFixture();
      rewriteHoistModules(h, (m) => {
        (m.hoistedDependencies as Record<string, unknown>)[
          'string-width@4.2.3'
        ] = aliases;
      });
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
    },
  );
  it.each([
    'string-width',
    'string-width@latest',
    'string-width@^4.2.3',
    'string-width@04.2.3',
    'string-width@4.2.3(peer@1.0.0)',
    'string-width@4.2.3-beta.1',
    'npm:string-width@4.2.3',
    'string-width@npm:other@4.2.3',
    'file:../string-width',
    'link:../string-width',
    'workspace:string-width@4.2.3',
    'git+https://example.test/string-width',
    'https://example.test/string-width@4.2.3',
    '@test@4.2.3',
    '@test//tool@4.2.3',
    '../string-width@4.2.3',
    'string-width\\evil@4.2.3',
    'string-width\u0000@4.2.3',
    'String-width@4.2.3',
  ])(
    'refuses unsupported hoist locator %s before opening its destination',
    async (locator) => {
      const h = await pnpm10PrivateHoistFixture();
      rewriteHoistModules(h, (m) => {
        const hoists = m.hoistedDependencies as Record<string, unknown>;
        delete hoists['string-width@4.2.3'];
        hoists[locator] = { 'string-width': 'private' };
      });
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
      expect(
        h.open.mock.calls.some(([p]) => /example\.test|evil/.test(p)),
      ).toBe(false);
    },
  );
  it.each([
    'duplicate-version',
    'case-clash',
    'prototype-key',
    'duplicate-key',
  ])('refuses hoist ambiguity %s', async (kind) => {
    const h = await pnpm10PrivateHoistFixture();
    rewriteHoistModules(h, (m) => {
      const hoists = m.hoistedDependencies as Record<string, unknown>;
      hoists[
        kind === 'duplicate-version'
          ? 'string-width@4.2.2'
          : 'String-width@4.2.3'
      ] = { 'string-width': 'private' };
    });
    if (kind === 'prototype-key' || kind === 'duplicate-key') {
      const path = win32.join(P10.root, 'node_modules/.modules.yaml');
      const text = h.entries.get(path.toLowerCase())!.text!;
      h.put(path, {
        text: text.replace(
          '"hoistedDependencies":{',
          kind === 'prototype-key'
            ? '"hoistedDependencies":{"__proto__":{},'
            : '"hoistedDependencies":{"string-width@4.2.3":{"string-width":"private"},',
        ),
      });
    }
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it.each([
    'missing-link',
    'extra-link',
    'empty-map',
    'public-root',
    'wrong-target',
    'outside',
    'ordinary-directory',
    'private-bin',
    'redirected-scope',
    'redirected-directory',
    'redirected-target',
    'wrong-manifest-name',
    'wrong-manifest-version',
    'manifest-symlink',
  ])('refuses incoherent private hoist topology %s', async (kind) => {
    const h = await pnpm10PrivateHoistFixture(kind === 'redirected-scope');
    const link = `${P10.root}\\.pnpm\\node_modules\\string-width`;
    const target = `${P10.root}\\.pnpm\\string-width@4.2.3\\node_modules\\string-width`;
    if (kind === 'missing-link') h.entries.delete(link.toLowerCase());
    if (kind === 'extra-link')
      h.put(`${P10.root}\\.pnpm\\node_modules\\unlisted`, {
        link: true,
        real: target,
      });
    if (kind === 'empty-map')
      rewriteHoistModules(h, (m) => {
        m.hoistedDependencies = {};
      });
    if (kind === 'public-root')
      h.put(`${P10.root}\\node_modules\\string-width`, {
        link: true,
        real: target,
      });
    if (kind === 'wrong-target' || kind === 'outside')
      h.put(link, {
        link: true,
        real:
          kind === 'outside'
            ? 'E:\\TEST\\outside'
            : `${P10.root}\\.pnpm\\strip-ansi@6.0.1\\node_modules\\strip-ansi`,
      });
    if (kind === 'ordinary-directory') h.put(link, { directory: true });
    if (kind === 'private-bin')
      h.put(`${P10.root}\\.pnpm\\node_modules\\.bin\\tool.cmd`, {
        text: 'TEST unproved private shim',
      });
    if (kind === 'redirected-scope')
      h.put(`${P10.root}\\.pnpm\\node_modules\\@test`, {
        link: true,
        real: 'E:\\TEST\\outside',
      });
    if (kind === 'redirected-directory')
      h.put(`${P10.root}\\.pnpm\\node_modules`, {
        link: true,
        real: 'E:\\TEST\\outside',
      });
    if (kind === 'redirected-target')
      h.put(win32.dirname(target), { link: true, real: 'E:\\TEST\\outside' });
    if (kind.startsWith('wrong-manifest'))
      h.put(`${target}\\package.json`, {
        text: JSON.stringify({
          name: kind.endsWith('name') ? 'other' : 'string-width',
          version: kind.endsWith('version') ? '4.2.2' : '4.2.3',
        }),
      });
    if (kind === 'manifest-symlink')
      h.put(`${target}\\package.json`, {
        link: true,
        real: 'E:\\TEST\\outside\\package.json',
      });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
    expect(h.lstat.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
  });
  it.each([
    'missing-package',
    'missing-snapshot',
    'wrong-version',
    'current-lock',
    'tarball',
    'extra-field',
    'file',
    'git',
    'link',
    'directory',
    'missing-integrity',
    'invalid-integrity',
    'array-resolution',
  ])(
    'requires integrity-only registry corroboration for hoist %s',
    async (kind) => {
      const h = await pnpm10PrivateHoistFixture();
      for (const relative of [
        'pnpm-lock.yaml',
        'node_modules/.pnpm/lock.yaml',
      ]) {
        const path = win32.join(P10.root, relative);
        const lock = parse(h.entries.get(path.toLowerCase())!.text!) as {
          packages: Record<string, { resolution: unknown }>;
          snapshots: Record<string, unknown>;
        };
        const locator = 'string-width@4.2.3';
        if (kind === 'missing-package') delete lock.packages[locator];
        else if (kind === 'missing-snapshot') delete lock.snapshots[locator];
        else if (kind === 'wrong-version') {
          lock.packages['string-width@4.2.2'] = lock.packages[locator];
          delete lock.packages[locator];
        } else if (kind === 'current-lock') {
          if (relative.startsWith('node_modules'))
            delete lock.packages[locator];
        } else
          lock.packages[locator].resolution = (
            {
              tarball: {
                integrity: 'sha512-TEST==',
                tarball: 'https://example.test/tool.tgz',
              },
              'extra-field': { integrity: 'sha512-TEST==', unexpected: 'TEST' },
              file: { integrity: 'sha512-TEST==', tarball: 'file:../tool.tgz' },
              git: {
                integrity: 'sha512-TEST==',
                repo: 'https://example.test/tool.git',
              },
              link: { integrity: 'sha512-TEST==', type: 'link' },
              directory: { directory: '../tool', type: 'directory' },
              'missing-integrity': {},
              'invalid-integrity': { integrity: 'not-integrity' },
              'array-resolution': ['sha512-TEST=='],
            } as Record<string, unknown>
          )[kind];
        h.put(path, { text: stringify(lock) });
      }
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
    },
  );
  it.each(['link', 'directory', 'cancel'])(
    'refuses private-hoist drift/cancellation during structural enumeration: %s',
    async (kind) => {
      const h = await pnpm10PrivateHoistFixture();
      const original = h.readdir.getMockImplementation()! as (
        path: string,
      ) => Promise<readonly string[]>;
      let observations = 0;
      h.readdir.mockImplementation((path: string) => {
        if (
          path.toLowerCase() ===
            `${P10.root}\\.pnpm\\node_modules`.toLowerCase() &&
          ++observations === 2
        ) {
          if (kind === 'cancel')
            h.controller.abort(new Error('TEST private hoist abort'));
          else if (kind === 'link')
            h.put(`${P10.root}\\.pnpm\\node_modules\\string-width`, {
              link: true,
              real: `${P10.root}\\.pnpm\\strip-ansi@6.0.1\\node_modules\\strip-ansi`,
            });
          else
            h.put(`${P10.root}\\.pnpm\\string-width@4.2.3\\node_modules`, {
              link: true,
              real: 'E:\\TEST\\outside',
            });
        }
        return original(path);
      });
      if (kind === 'cancel')
        await expect(
          readPnpm10GlobalInventory(h.location, h.deps),
        ).rejects.toThrow('TEST private hoist abort');
      else
        await expectGlobalReason(
          () => readPnpm10GlobalInventory(h.location, h.deps),
          'INVENTORY_FAILED',
        );
      expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
    },
  );
  it.each(['ordinary-alias', 'scoped-child', 'private-bin'])(
    'refuses an undeclared %s added on the second private-directory enumeration',
    async (kind) => {
      const h = await pnpm10PrivateHoistFixture(kind === 'scoped-child');
      const before = await readPnpm10GlobalInventory(h.location, h.deps);
      expect(before.packages.map((p) => p.name)).toEqual([
        'cliui',
        'wrap-ansi',
      ]);
      expect(before.ownershipComplete).toBe(true);
      const privateDirectory = `${P10.root}\\.pnpm\\node_modules`;
      const observedDirectory =
        kind === 'scoped-child'
          ? `${privateDirectory}\\@test`
          : privateDirectory;
      const original = h.readdir.getMockImplementation()! as (
        path: string,
      ) => Promise<readonly string[]>;
      let observations = 0;
      h.readdir.mockImplementation((path: string) => {
        if (
          path.toLowerCase() === observedDirectory.toLowerCase() &&
          ++observations === 2
        ) {
          if (kind === 'private-bin')
            h.put(`${privateDirectory}\\.bin\\unproved.cmd`, {
              text: 'TEST inert private shim',
            });
          else
            h.put(`${observedDirectory}\\unlisted`, {
              link: true,
              real: `${P10.root}\\.pnpm\\string-width@4.2.3\\node_modules\\string-width`,
            });
        }
        return original(path);
      });
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
      expect(observations).toBe(2);
      expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );
  it('caps private-hoist declarations and nested metadata before traversal', async () => {
    const h = await pnpm10PrivateHoistFixture();
    rewriteHoistModules(h, (m) => {
      m.hoistedDependencies = Object.fromEntries(
        Array.from({ length: 10_001 }, (_, i) => [
          `test-${i}@1.0.0`,
          { [`test-${i}`]: 'private' },
        ]),
      );
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'LIMIT_EXCEEDED',
    );
    const nested = await pnpm10PrivateHoistFixture();
    const path = win32.join(P10.root, 'node_modules/.modules.yaml');
    nested.put(path, {
      text:
        '{"hoistedDependencies":' +
        '{"nested":'.repeat(65) +
        '{}' +
        '}'.repeat(65) +
        '}',
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(nested.location, nested.deps),
      'INVENTORY_FAILED',
    );
  });
  it('rejects private junction replacement during the final directory recheck', async () => {
    const h = await pnpm10PrivateHoistFixture();
    const original = h.readdir.getMockImplementation()! as (
      path: string,
    ) => Promise<readonly string[]>;
    let observations = 0;
    h.readdir.mockImplementation((path: string) => {
      if (
        path.toLowerCase() ===
          `${P10.root}\\.pnpm\\node_modules`.toLowerCase() &&
        ++observations === 3
      )
        h.put(`${P10.root}\\.pnpm\\node_modules\\string-width`, {
          link: true,
          real: `${P10.root}\\.pnpm\\strip-ansi@6.0.1\\node_modules\\strip-ansi`,
        });
      return original(path);
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it('requires the current lock for nonempty hoists even without direct dependencies', async () => {
    const h = await pnpm10PrivateHoistFixture();
    h.put(`${P10.root}\\package.json`, { text: '{"dependencies":{}}' });
    for (const name of ['cliui', 'wrap-ansi'])
      h.entries.delete(`${P10.root}\\node_modules\\${name}`.toLowerCase());
    const path = `${P10.root}\\pnpm-lock.yaml`;
    const lock = parse(h.entries.get(path.toLowerCase())!.text!) as {
      importers: Record<string, unknown>;
    };
    lock.importers['.'] = {};
    h.put(path, { text: stringify(lock) });
    h.entries.delete(
      `${P10.root}\\node_modules\\.pnpm\\lock.yaml`.toLowerCase(),
    );
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it('pins an already-proven direct manifest only once when also privately hoisted', async () => {
    const h = await pnpm10PrivateHoistFixture();
    rewriteHoistModules(h, (m) => {
      (m.hoistedDependencies as Record<string, unknown>)['cliui@8.0.1'] = {
        cliui: 'private',
      };
    });
    h.put(`${P10.root}\\.pnpm\\node_modules\\cliui`, {
      link: true,
      real: `${P10.root}\\.pnpm\\cliui@8.0.1\\node_modules\\cliui`,
    });
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages.map((p) => p.name)).toEqual(['cliui', 'wrap-ansi']);
    expect(
      r.pnpm10Inventory?.project.files.filter(
        (f) =>
          f.file.path ===
          `${P10.root}\\.pnpm\\cliui@8.0.1\\node_modules\\cliui\\package.json`,
      ),
    ).toHaveLength(1);
    expect(r.facts.find((f) => f.name === 'cliui')?.manifest.file.path).toBe(
      `${P10.root}\\.pnpm\\cliui@8.0.1\\node_modules\\cliui\\package.json`,
    );
  });
  it('rejects same-identity manifest byte drift between private and direct proofs', async () => {
    const h = await pnpm10PrivateHoistFixture();
    rewriteHoistModules(h, (m) => {
      (m.hoistedDependencies as Record<string, unknown>)['cliui@8.0.1'] = {
        cliui: 'private',
      };
    });
    const target = `${P10.root}\\.pnpm\\cliui@8.0.1\\node_modules\\cliui`;
    h.put(`${P10.root}\\.pnpm\\node_modules\\cliui`, {
      link: true,
      real: target,
    });
    const manifest = `${target}\\package.json`;
    const text = JSON.stringify({
      name: 'cliui',
      version: '8.0.1',
      marker: 'old',
    });
    h.put(manifest, { text });
    const original = h.open.getMockImplementation()!;
    let reads = 0;
    h.open.mockImplementation((path) => {
      if (path === manifest && ++reads === 2)
        h.put(manifest, { text: text.replace('old', 'new') });
      return original(path);
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it('proves an existing all-registry binless project with its configured bin directory absent', async () => {
    const h = await pnpm10BinlessFixture();
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toMatchObject([
      { name: 'is-number', version: '7.0.0', status: 'manageable' },
    ]);
    expect(r.ownershipComplete).toBe(true);
    expect(r.pnpm10Inventory?.project.missingPaths).toContain(
      h.location.binDir,
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it.each([1, 6])(
    'refuses missing-bin proof for existing bins or linked/unknown bins (step %i)',
    async (step) => {
      const h = await pnpm10InventoryFixture(step),
        binDir = 'D:\\TEST\\absent-bin';
      h.location.binDir = binDir;
      h.location.pnpm10 = {
        ...h.location.pnpm10,
        binDir,
        missingDirectoryPaths: [binDir],
      };
      await expectGlobalReason(
        () =>
          readPnpm10GlobalInventory(h.location, h.deps, {
            allowMissingBinDir: true,
          }),
        'PNPM_GLOBAL_NOT_CONFIGURED',
      );
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );
  it('rejects an absent bin directory appearing empty while the project is being read', async () => {
    const h = await pnpm10BinlessFixture(),
      original = h.lstat.getMockImplementation()!;
    let observations = 0;
    h.lstat.mockImplementation((p) => {
      if (
        p.toLowerCase() === h.location.binDir.toLowerCase() &&
        ++observations === 3
      )
        h.put(h.location.binDir, { directory: true });
      return original(p);
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    'matches F5b b%i list --json direct rows',
    async (step) => {
      const h = await pnpm10InventoryFixture(step);
      const result = await readPnpm10GlobalInventory(h.location, h.deps);
      expect(
        result.packages.map(({ name, version }) => ({ name, version })),
      ).toEqual(
        Object.entries(h.snapshot.list[0].dependencies ?? {})
          .map(([name, d]) => ({ name, version: d.version }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      expect(result.ownershipComplete).toBe(true);
      expect(result.pnpm10Inventory?.project.dependencies).toHaveLength(
        result.packages.length,
      );
      expect(h.spawn).not.toHaveBeenCalled();
      expect(
        h.open.mock.calls.some(
          ([p]) =>
            !p.toLowerCase().startsWith(P10.root.toLowerCase()) &&
            !p.toLowerCase().startsWith(P10.home.toLowerCase()) &&
            /linksrc/i.test(p),
        ),
      ).toBe(false);
      const linked = result.packages.find((p) => p.name === 'f5b-local-tool');
      if (step === 6 || step === 7)
        expect(linked).toMatchObject({
          status: 'linked',
          reason: 'LINKED_PACKAGE',
        });
      else expect(linked).toBeUndefined();
    },
  );
  it('keeps retained versions, transitive junctions and stale local bins ancillary, including empty b9', async () => {
    const h = await pnpm10InventoryFixture(9);
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([]);
    expect(
      r.pnpm10Inventory?.project.ancillary.some((a) =>
        a.identity.path.includes('is-number@7.0.0'),
      ),
    ).toBe(true);
    expect(
      r.pnpm10Inventory?.project.ancillary.some((a) =>
        a.identity.path.includes('\\.bin\\'),
      ),
    ).toBe(true);
    expect(r.pnpm10Inventory?.project.missingPaths).toContain(
      `${P10.root}\\node_modules\\.pnpm\\lock.yaml`,
    );
  });
  it('supports an absent global project as empty, pinning absence', async () => {
    const h = await pnpm10InventoryFixture(9);
    for (const path of h.entries.keys())
      if (
        path === P10.root.toLowerCase() ||
        path.startsWith(`${P10.root.toLowerCase()}\\`)
      )
        h.entries.delete(path);
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([]);
    expect(r.ownershipComplete).toBe(true);
    expect(r.pnpm10Inventory?.project.missingPaths).toContain(P10.root);
  });
  it('accepts unpinned bin absence only for postcondition proof of an existing binless project', async () => {
    const h = await pnpm10InventoryFixture(9);
    const binDir = 'D:\\TEST\\separate-bin';
    h.location.binDir = binDir;
    h.location.pnpm10 = { ...h.location.pnpm10, binDir };
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    const r = await readPnpm10GlobalInventory(h.location, h.deps, {
      allowMissingBinDir: true,
    });
    expect(r.pnpm10Inventory?.binSlots).toEqual([]);
    expect(r.pnpm10Inventory?.project.missingPaths).toContain(binDir);
    expect(r.ownershipComplete).toBe(true);
  });
  it('rejects a configured absent bin directory already present at inventory start', async () => {
    const h = await pnpm10BinlessFixture();
    h.put(h.location.binDir, { directory: true });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('refuses missing bin proof when the global project is also absent', async () => {
    const h = await pnpm10BinlessFixture();
    for (const p of h.entries.keys())
      if (
        p === P10.root.toLowerCase() ||
        p.startsWith(`${P10.root.toLowerCase()}\\`)
      )
        h.entries.delete(p);
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'PNPM_GLOBAL_NOT_CONFIGURED',
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('proves an existing empty project after removing the last binless package', async () => {
    const h = await pnpm10BinlessFixture(null);
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([]);
    expect(r.ownershipComplete).toBe(true);
    expect(r.pnpm10Inventory?.project.root).not.toBeNull();
    expect(r.pnpm10Inventory?.project.missingPaths).toContain(
      h.location.binDir,
    );
  });
  it.each([
    'package.json',
    'pnpm-lock.yaml',
    '.pnpm/is-number@7.0.0/node_modules/is-number/package.json',
  ])('refuses absent bin with missing metadata: %s', async (relative) => {
    const h = await pnpm10BinlessFixture();
    const file = win32.join(P10.root, relative);
    h.entries.delete(file.toLowerCase());
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it.each(['f5b-local-tool', 'npm'])(
    'refuses missing-bin linked-only %s without following its source',
    async (name) => {
      const h = await pnpm10BinlessFixture();
      for (const relative of [
        'package.json',
        'pnpm-lock.yaml',
        'node_modules/.pnpm/lock.yaml',
      ]) {
        const file = win32.join(P10.root, relative),
          entry = h.entries.get(file.toLowerCase())!;
        const data = parse(entry.text!) as {
          dependencies?: Record<string, unknown>;
          importers?: Record<
            string,
            { dependencies?: Record<string, unknown> }
          >;
        };
        const dependencies =
          data.importers?.['.']?.dependencies ?? data.dependencies!;
        delete dependencies['is-number'];
        dependencies[name] =
          relative === 'package.json'
            ? 'link:../../linksrc'
            : {
                specifier: 'link:../../linksrc',
                version: 'link:../../linksrc',
              };
        h.put(file, {
          text:
            relative === 'package.json'
              ? JSON.stringify(data)
              : stringify(data),
        });
      }
      h.entries.delete(`${P10.root}\\node_modules\\is-number`.toLowerCase());
      h.put(`${P10.root}\\node_modules\\${name}`, {
        link: true,
        real: 'E:\\TEST\\linksrc',
      });
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'PNPM_GLOBAL_NOT_CONFIGURED',
      );
      expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
      expect(
        h.readdir.mock.calls.some(([p]) => String(p).startsWith('E:')),
      ).toBe(false);
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );
  it.each([
    'manifest',
    'wanted',
    'current',
    'modules',
    'workspace',
    'extra-link',
    'duplicate',
    'resolution-shape',
  ])('refuses inconsistent metadata: %s', async (kind) => {
    const h = await pnpm10InventoryFixture(2);
    const file = (suffix: string) => `${P10.root}\\${suffix}`;
    if (kind === 'manifest')
      h.put(file('package.json'), {
        text: '{"dependencies":{"semver":"0.0.1"}}',
      });
    if (kind === 'wanted')
      h.put(file('pnpm-lock.yaml'), {
        text: h.snapshot.files['pnpm-lock.yaml'].replace('7.7.3', '7.7.4'),
      });
    if (kind === 'current')
      h.put(file('node_modules\\.pnpm\\lock.yaml'), {
        text: "lockfileVersion: '9.0'\nimporters: { '.': {} }",
      });
    if (kind === 'modules')
      h.put(file('node_modules\\.modules.yaml'), {
        text: h.snapshot.files['node_modules/.modules.yaml'].replace(
          'isolated',
          'hoisted',
        ),
      });
    if (kind === 'workspace')
      h.put(file('node_modules\\.pnpm-workspace-state-v1.json'), {
        text: '{"pnpmfiles":["evil.cjs"]}',
      });
    if (kind === 'extra-link')
      h.put(file('node_modules\\unexpected'), {
        link: true,
        real: 'E:\\TEST\\foreign',
      });
    if (kind === 'duplicate')
      h.put(file('package.json'), {
        text: '{"dependencies":{},"dependencies":{}}',
      });
    if (kind === 'resolution-shape')
      for (const relative of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'])
        h.put(win32.join(P10.root, relative), {
          text: h.snapshot.files[relative].replace(
            'resolution: {integrity:',
            'resolution: {tarball: [], integrity:',
          ),
        });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it('refuses redirected direct links before external reads and link replacement after validation', async () => {
    const h = await pnpm10InventoryFixture(1);
    const link = `${P10.root}\\node_modules\\semver`;
    h.put(link, { link: true, real: 'E:\\TEST\\outside' });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
    expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
    const r = await pnpm10InventoryFixture(1);
    const original = r.realpath.getMockImplementation()!;
    let times = 0;
    r.realpath.mockImplementation((p) =>
      p.toLowerCase() === link.toLowerCase() && ++times > 1
        ? Promise.resolve('E:\\TEST\\replaced')
        : original(p),
    );
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(r.location, r.deps),
      'INVENTORY_FAILED',
    );
  });
  it('marks malformed/colliding shim families read-only without losing rows', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.home}\\semver.exe`, { bytes: new Uint8Array([0, 255, 0]) });
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([
      expect.objectContaining({
        name: 'semver',
        status: 'invalid',
        reason: 'BIN_CONFLICT',
      }),
    ]);
    expect(r.ownershipComplete).toBe(false);
  });
  // Real globals carry tens of thousands of package files in R\.pnpm. Only the
  // virtual-store structure (<id>\node_modules\<name|@scope\name>) is pinned.
  it('never enumerates package contents inside the virtual store', async () => {
    const h = await pnpm10InventoryFixture(3);
    const semver = `${P10.root}\\.pnpm\\semver@7.7.3\\node_modules\\semver`;
    const once = `${P10.root}\\.pnpm\\@tootallnate+once@2.0.0\\node_modules\\@tootallnate\\once`;
    h.put(`${semver}\\functions\\TEST.js`, { text: '// TEST package file' });
    h.put(`${once}\\dist\\TEST.js`, { text: '// TEST package file' });
    const result = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(result.packages.map((p) => p.name)).toEqual([
      '@tootallnate/once',
      'is-number',
      'semver',
    ]);
    const listed = h.readdir.mock.calls.map(([path]) =>
      String(path).toLowerCase(),
    );
    for (const packageDir of [semver, once])
      expect(
        listed.filter(
          (path) =>
            path === packageDir.toLowerCase() ||
            path.startsWith(`${packageDir.toLowerCase()}\\`),
        ),
      ).toEqual([]);
    expect(listed).toContain(
      `${P10.root}\\.pnpm\\@tootallnate+once@2.0.0\\node_modules\\@tootallnate`.toLowerCase(),
    );
  });

  it('bounds file/entry/row/depth budgets and propagates cancellation', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.root}\\package.json`, { text: ' '.repeat(1024 * 1024 + 1) });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'LIMIT_EXCEEDED',
    );
    const e = await pnpm10InventoryFixture(1);
    e.readdir.mockResolvedValue(
      Array.from({ length: 40_001 }, (_, i) => `TEST${i}`),
    );
    await expect(
      readPnpm10GlobalInventory(e.location, e.deps),
    ).rejects.toThrow();
    const rows = await pnpm10InventoryFixture(1);
    rows.put(`${P10.root}\\package.json`, {
      text: JSON.stringify({
        dependencies: Object.fromEntries(
          Array.from({ length: 10_001 }, (_, i) => [`test-${i}`, '1.0.0']),
        ),
      }),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(rows.location, rows.deps),
      'LIMIT_EXCEEDED',
    );
    const deep = await pnpm10InventoryFixture(1);
    deep.put(`${P10.root}\\package.json`, {
      text: '{"x":'.repeat(65) + '{}' + '}'.repeat(65),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(deep.location, deep.deps),
      'LIMIT_EXCEEDED',
    );
    const c = await pnpm10InventoryFixture();
    c.controller.abort(new Error('TEST abort'));
    await expect(readPnpm10GlobalInventory(c.location, c.deps)).rejects.toThrow(
      'TEST abort',
    );
  });

  it.each(['store', 'virtual', 'manifest-version', 'missing-current'])(
    'refuses contradictory installation facts: %s',
    async (kind) => {
      const h = await pnpm10InventoryFixture(1);
      if (kind === 'store' || kind === 'virtual') {
        const modules = JSON.parse(
          h.snapshot.files['node_modules/.modules.yaml'],
        ) as Record<string, unknown>;
        modules[kind === 'store' ? 'storeDir' : 'virtualStoreDir'] =
          'E:\\TEST\\foreign';
        h.put(`${P10.root}\\node_modules\\.modules.yaml`, {
          text: JSON.stringify(modules),
        });
      }
      if (kind === 'manifest-version')
        h.put(
          `${P10.root}\\.pnpm\\semver@7.7.3\\node_modules\\semver\\package.json`,
          { text: '{"name":"semver","version":"7.7.4"}' },
        );
      if (kind === 'missing-current')
        h.entries.delete(
          `${P10.root}\\node_modules\\.pnpm\\lock.yaml`.toLowerCase(),
        );
      await expectGlobalReason(
        () => readPnpm10GlobalInventory(h.location, h.deps),
        'INVENTORY_FAILED',
      );
      expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
    },
  );

  it('keeps inventory correct when old virtual-store cache entries have been pruned', async () => {
    const h = await pnpm10InventoryFixture(9);
    for (const path of [...h.entries.keys()])
      if (path.startsWith(`${P10.root}\\.pnpm\\`.toLowerCase()))
        h.entries.delete(path);
    const modules = JSON.parse(
      h.snapshot.files['node_modules/.modules.yaml'],
    ) as Record<string, unknown>;
    modules.prunedAt = 'Fri, 01 Jan 2021 00:00:00 GMT';
    h.put(`${P10.root}\\node_modules\\.modules.yaml`, {
      text: JSON.stringify(modules),
    });
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages).toEqual([]);
    expect(r.ownershipComplete).toBe(true);
  });

  it('reserves arbitrary foreign names without poisoning valid package protection inputs', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.home}\\foreign file.txt`, { text: 'TEST reserved' });
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    const fact = r.facts[0];
    expect(r.ownershipComplete).toBe(true);
    expect(
      r.pnpm10Inventory?.binSlots.some(
        (s) => s.name === 'foreign file.txt' && s.owner === null,
      ),
    ).toBe(true);
    expect(() =>
      assertGlobalPackageMutable({
        packageName: fact.name,
        packageRoot: fact.packageRoot,
        linked: false,
        currentBins: fact.bins,
        targetBins: [],
        binOwners: r.binOwners,
        ownershipComplete: r.ownershipComplete,
        protectedPaths: [],
      }),
    ).not.toThrow();
  });

  it.each([
    'file:../tool',
    'npm:other@7.7.3',
    'git+https://example.test/tool.git',
    'https://example.test/tool.tgz',
    'resolution',
  ])(
    'keeps other rows beside unsupported direct dependency %s',
    async (kind) => {
      const h = await pnpm10InventoryFixture(2);
      const manifest = JSON.parse(h.snapshot.files['package.json']) as {
        dependencies: Record<string, string>;
      };
      const spec = kind === 'resolution' ? manifest.dependencies.semver : kind;
      manifest.dependencies.semver = spec;
      h.put(`${P10.root}\\package.json`, { text: JSON.stringify(manifest) });
      for (const relative of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'])
        h.put(win32.join(P10.root, relative), {
          text: (() => {
            const lock = parse(h.snapshot.files[relative]) as {
              importers: {
                '.': { dependencies: Record<string, { specifier: string }> };
              };
              packages: Record<string, { resolution: Record<string, string> }>;
            };
            lock.importers['.'].dependencies.semver.specifier = spec;
            if (kind === 'resolution')
              lock.packages['semver@7.7.3'].resolution.tarball =
                'https://example.test/tool.tgz';
            return stringify(lock);
          })(),
        });
      const result = await readPnpm10GlobalInventory(h.location, h.deps);
      expect(result.packages.find((r) => r.name === 'semver')).toMatchObject({
        status: 'invalid',
        reason: 'INVENTORY_FAILED',
      });
      expect(result.packages.find((r) => r.name === 'is-number')).toMatchObject(
        { status: 'manageable' },
      );
      expect(result.ownershipComplete).toBe(false);
      expect(result.facts.some((f) => f.name === 'semver')).toBe(false);
      expect(
        result.pnpm10Inventory?.project.dependencies.find(
          (d) => d.name === 'semver',
        )?.linkIdentity,
      ).toBeDefined();
    },
  );

  it('refuses wanted/current lock settings that disagree', async () => {
    const h = await pnpm10InventoryFixture(1);
    h.put(`${P10.root}\\node_modules\\.pnpm\\lock.yaml`, {
      text: h.snapshot.files['node_modules/.pnpm/lock.yaml'].replace(
        'autoInstallPeers: true',
        'autoInstallPeers: false',
      ),
    });
    await expectGlobalReason(
      () => readPnpm10GlobalInventory(h.location, h.deps),
      'INVENTORY_FAILED',
    );
  });
  it.each([
    [
      'file:../tool',
      'file:../tool',
      { directory: '../tool', type: 'directory' },
    ],
    ['npm:other@7.7.3', 'other@7.7.3', { integrity: 'sha512-TEST==' }],
    [
      'git+https://example.test/tool.git',
      'https://example.test/tool/TEST',
      { repo: 'https://example.test/tool.git', commit: 'TEST', type: 'git' },
    ],
    [
      'latest',
      'https://example.test/tool.tgz',
      { tarball: 'https://example.test/tool.tgz' },
    ],
  ] as const)(
    'pins unsupported non-semver reference %s without opening external targets',
    async (spec, ref, resolution) => {
      const h = await pnpm10InventoryFixture(2);
      const manifest = JSON.parse(h.snapshot.files['package.json']) as {
        dependencies: Record<string, string>;
      };
      manifest.dependencies.semver = spec;
      h.put(`${P10.root}\\package.json`, { text: JSON.stringify(manifest) });
      h.put(`${P10.root}\\node_modules\\semver`, {
        link: true,
        real: 'E:\\TEST\\external-tool',
      });
      for (const relative of [
        'pnpm-lock.yaml',
        'node_modules/.pnpm/lock.yaml',
      ]) {
        const lock = parse(h.snapshot.files[relative]) as {
          importers: {
            '.': {
              dependencies: Record<
                string,
                { specifier: string; version: string }
              >;
            };
          };
          packages: Record<string, unknown>;
          snapshots: Record<string, unknown>;
        };
        lock.importers['.'].dependencies.semver = {
          specifier: spec,
          version: ref,
        };
        delete lock.packages['semver@7.7.3'];
        delete lock.snapshots['semver@7.7.3'];
        lock.packages[ref] = { resolution };
        lock.snapshots[ref] = {};
        h.put(win32.join(P10.root, relative), { text: stringify(lock) });
      }
      const result = await readPnpm10GlobalInventory(h.location, h.deps);
      expect(result.packages.find((r) => r.name === 'semver')).toMatchObject({
        status: 'invalid',
        reason: 'INVENTORY_FAILED',
      });
      expect(result.packages.find((r) => r.name === 'is-number')?.status).toBe(
        'manageable',
      );
      expect(h.open.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
      expect(h.lstat.mock.calls.some(([p]) => p.startsWith('E:'))).toBe(false);
    },
  );
  it('derives scoped, peer-suffixed and hashed long virtual-store names from pnpm source', async () => {
    expect(pnpm10DepPathToFilename('@test/tool@1.0.0', 60)).toBe(
      '@test+tool@1.0.0',
    );
    expect(pnpm10DepPathToFilename('tool@1.0.0(peer@2.0.0)', 60)).toBe(
      'tool@1.0.0_peer@2.0.0',
    );
    expect(pnpm10DepPathToFilename(`${'a'.repeat(80)}@1.0.0`, 60)).toMatch(
      /^a{27}_[a-f0-9]{32}$/,
    );
    const h = await pnpm10InventoryFixture(1);
    const from = `${P10.root}\\.pnpm\\semver@7.7.3`;
    const to = `${P10.root}\\.pnpm\\semver@7.7.3_peer@1.0.0`;
    for (const [path, value] of [...h.entries])
      if (path.startsWith(from.toLowerCase())) {
        h.entries.delete(path);
        h.put(to + path.slice(from.length), value);
      }
    h.put(`${P10.root}\\node_modules\\semver`, {
      link: true,
      real: `${to}\\node_modules\\semver`,
    });
    for (const relative of ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml'])
      h.put(win32.join(P10.root, relative), {
        text: h.snapshot.files[relative]
          .replace('version: 7.7.3', 'version: 7.7.3(peer@1.0.0)')
          .replace(
            'snapshots:\n\n  semver@7.7.3:',
            'snapshots:\n\n  semver@7.7.3(peer@1.0.0):',
          ),
      });
    // Bin ownership fails safely because the old wrappers still point to the old store.
    const r = await readPnpm10GlobalInventory(h.location, h.deps);
    expect(r.packages[0]).toMatchObject({
      name: 'semver',
      version: '7.7.3',
      reason: 'BIN_CONFLICT',
    });
  });
});
