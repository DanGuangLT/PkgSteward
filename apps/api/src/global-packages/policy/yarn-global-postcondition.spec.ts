import 'reflect-metadata';
import { win32 } from 'node:path';
import { snapshotGlobalPreviewFacts } from '@/global-packages/policy/global-preview';
import { readYarnGlobalInventory } from '@/global-packages/discovery/yarn-global-inventory';
import {
  assertYarnGlobalMutable,
  verifyYarnGlobalPostcondition,
} from '@/global-packages/policy/yarn-global-postcondition';
import {
  expectGlobalReason,
  memoryFs,
  testSpawn,
} from '@/global-packages/__fixtures__/global-adapters';
import {
  YARN_TEST_PATHS as Y,
  yarnLocation,
} from '@/global-packages/__fixtures__/yarn1/facts';
import {
  yarnGlobalBinShims,
  yarnLocalBinShims,
} from '@/global-packages/__fixtures__/yarn1/shims';
import type { IGlobalPreviewFacts } from '@/global-packages/interfaces/global-packages.runtime';

describe('yarn-global-postcondition', () => {
  const signal = new AbortController().signal;
  const globalDotBin = win32.join(Y.root, '.bin');

  const seed = async (options: {
    semverVersion?: string;
    includeSemver?: boolean;
    neighbourVersion?: string;
    foreignBin?: boolean;
  }) => {
    const mem = memoryFs();
    mem.put(Y.global, { directory: true });
    mem.put(Y.root, { directory: true });
    mem.put(Y.bin, { directory: true });
    mem.put(globalDotBin, { directory: true });
    const deps: Record<string, string> = {
      'is-odd': `^${options.neighbourVersion ?? '3.0.0'}`,
    };
    const lockLines = [
      `"is-odd@^${options.neighbourVersion ?? '3.0.0'}":`,
      `  version "${options.neighbourVersion ?? '3.0.0'}"`,
      `  resolved "https://registry.yarnpkg.com/is-odd/-/is-odd-${options.neighbourVersion ?? '3.0.0'}.tgz#bbbb"`,
      `  integrity sha512-isodd${options.neighbourVersion ?? '3.0.0'}==`,
    ];
    mem.put(win32.join(Y.root, 'is-odd', 'package.json'), {
      text: JSON.stringify({
        name: 'is-odd',
        version: options.neighbourVersion ?? '3.0.0',
      }),
    });

    const binNames: string[] = [];
    const localNames: string[] = [];
    if (options.includeSemver !== false) {
      const sv = options.semverVersion ?? '7.7.1';
      deps.semver = sv;
      lockLines.push(
        `semver@${sv}:`,
        `  version "${sv}"`,
        `  resolved "https://registry.yarnpkg.com/semver/-/semver-${sv}.tgz#aaaa"`,
        `  integrity sha512-sv${sv}==`,
      );
      const target = win32.join(Y.root, 'semver', 'bin', 'semver.js');
      mem.put(win32.join(Y.root, 'semver', 'package.json'), {
        text: JSON.stringify({
          name: 'semver',
          version: sv,
          bin: { semver: 'bin/semver.js' },
        }),
      });
      mem.put(target, { text: `// semver ${sv}` });
      const l = yarnLocalBinShims(globalDotBin, 'semver', target);
      const g = yarnGlobalBinShims(Y.bin, globalDotBin, 'semver');
      mem.put(l.cmdPath, { text: l.cmdText });
      mem.put(l.shPath, { text: l.shText });
      mem.put(g.cmdPath, { text: g.cmdText });
      mem.put(g.shPath, { text: g.shText });
      binNames.push('semver', 'semver.cmd');
      localNames.push('semver', 'semver.cmd');
    }
    if (options.foreignBin) {
      mem.put(win32.join(Y.bin, 'foreign.cmd'), { text: '@echo foreign\r\n' });
      binNames.push('foreign.cmd');
    }
    mem.put(win32.join(Y.global, 'package.json'), {
      text: JSON.stringify({ dependencies: deps }),
    });
    mem.put(win32.join(Y.global, 'yarn.lock'), {
      text: lockLines.join('\n'),
    });
    mem.readdir.mockImplementation((dir: string) => {
      const lower = win32.resolve(dir).toLowerCase();
      if (lower === Y.bin.toLowerCase())
        return Promise.resolve(binNames.sort());
      if (lower === globalDotBin.toLowerCase())
        return Promise.resolve(localNames.sort());
      return Promise.resolve([]);
    });

    const loc = yarnLocation();
    const inventory = await readYarnGlobalInventory(loc, {
      fs: mem.fs,
      environment: {},
      signal,
      spawn: testSpawn(),
    });
    return { loc, inventory };
  };

  it('asserts change/remove postcondition AND neighbor + foreign slot invariance', async () => {
    const before = await seed({ semverVersion: '7.7.1', foreignBin: true });
    assertYarnGlobalMutable({
      location: before.loc,
      inventory: before.inventory,
      packageName: 'semver',
      action: 'change',
    });
    const beforeFacts: IGlobalPreviewFacts = {
      location: before.loc,
      current: before.inventory.facts.find((f) => f.name === 'semver')!,
      target: {
        name: 'semver',
        version: '7.7.2',
        requestedVersion: '7.7.2',
        manifestHash: 'TEST',
        integrity: 'TEST',
        bins: [{ name: 'semver', target: 'bin/semver.js' }],
        engines: null,
        deprecated: false,
      },
      binOwners: before.inventory.binOwners,
      yarnInventory: before.inventory.yarnInventory,
    };

    const goodAfter = await seed({ semverVersion: '7.7.2', foreignBin: true });
    expect(
      verifyYarnGlobalPostcondition(beforeFacts, goodAfter.inventory, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(true);
    expect(
      verifyYarnGlobalPostcondition(
        snapshotGlobalPreviewFacts(beforeFacts),
        goodAfter.inventory,
        {
          action: 'change',
          package: 'semver',
        },
      ),
    ).toBe(true);

    const removedAfter = await seed({ includeSemver: false, foreignBin: true });
    expect(
      verifyYarnGlobalPostcondition(
        { ...beforeFacts, target: null },
        removedAfter.inventory,
        { action: 'remove', package: 'semver' },
      ),
    ).toBe(true);

    // Neighbor silently mutated -> POSTCONDITION FAILED (false)
    const mutatedNeighbour = await seed({
      semverVersion: '7.7.2',
      neighbourVersion: '3.0.1',
      foreignBin: true,
    });
    expect(
      verifyYarnGlobalPostcondition(beforeFacts, mutatedNeighbour.inventory, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(false);

    // Foreign bin deleted -> POSTCONDITION FAILED (false)
    const missingForeign = await seed({
      semverVersion: '7.7.2',
      foreignBin: false,
    });
    expect(
      verifyYarnGlobalPostcondition(beforeFacts, missingForeign.inventory, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(false);
  });

  it('refuses incomplete ownership in assertYarnGlobalMutable', async () => {
    const s = await seed({ semverVersion: '7.7.1' });
    await expectGlobalReason(
      () =>
        assertYarnGlobalMutable({
          location: s.loc,
          inventory: { ...s.inventory, ownershipComplete: false },
          packageName: 'semver',
          action: 'change',
        }),
      'BIN_CONFLICT',
    );
  });

  it('blocks change & remove on protected neighbor and blocks change on scoped-registry neighbor while allowing remove', async () => {
    const base = await seed({ semverVersion: '7.7.1' });
    const protectedInv = {
      ...base.inventory,
      yarnInventory: {
        ...base.inventory.yarnInventory!,
        project: {
          ...base.inventory.yarnInventory!.project,
          dependencies: [
            ...base.inventory.yarnInventory!.project.dependencies,
            {
              ...base.inventory.yarnInventory!.project.dependencies[0],
              name: 'corepack',
              logicalPath: win32.join(Y.root, 'corepack'),
              realPath: win32.join(Y.root, 'corepack'),
            },
          ],
        },
      },
      packages: [
        ...base.inventory.packages,
        {
          name: 'corepack',
          version: '0.30.0',
          bins: [],
          status: 'protected' as const,
          reason: 'PROTECTED_PACKAGE' as const,
        },
      ],
    };
    for (const action of ['change', 'remove'] as const) {
      await expectGlobalReason(
        () =>
          assertYarnGlobalMutable({
            location: base.loc,
            inventory: protectedInv,
            packageName: 'semver',
            action,
          }),
        'PROTECTED_PACKAGE',
      );
    }

    const scopedLoc = yarnLocation({
      ...base.loc.yarn!,
      policy: {
        defaultRegistry: 'public',
        scopedRegistries: ['@corp'],
        unknownRouting: false,
        publicAuthPresent: false,
        changeUnsupported: false,
      },
    });
    const scopedInv = {
      ...base.inventory,
      yarnInventory: {
        ...base.inventory.yarnInventory!,
        project: {
          ...base.inventory.yarnInventory!.project,
          dependencies: [
            ...base.inventory.yarnInventory!.project.dependencies,
            {
              ...base.inventory.yarnInventory!.project.dependencies[0],
              name: '@corp/helper',
              logicalPath: win32.join(Y.root, '@corp', 'helper'),
              realPath: win32.join(Y.root, '@corp', 'helper'),
            },
          ],
        },
      },
      packages: [
        ...base.inventory.packages,
        {
          name: '@corp/helper',
          version: '1.0.0',
          bins: [],
          status: 'manageable' as const,
          reason: null,
        },
      ],
    };
    await expectGlobalReason(
      () =>
        assertYarnGlobalMutable({
          location: scopedLoc,
          inventory: scopedInv,
          packageName: 'semver',
          action: 'change',
        }),
      'REGISTRY_CONFIG_UNSUPPORTED',
    );
    expect(() =>
      assertYarnGlobalMutable({
        location: scopedLoc,
        inventory: scopedInv,
        packageName: 'semver',
        action: 'remove',
      }),
    ).not.toThrow();
  });
});
