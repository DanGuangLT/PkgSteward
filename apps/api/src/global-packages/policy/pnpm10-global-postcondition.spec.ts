import 'reflect-metadata';
import {
  pnpm10InventoryFixture,
  pnpm10PrivateHoistFixture,
} from '../__fixtures__/pnpm10/inventory';
import { readPnpm10GlobalInventory } from '../discovery/pnpm10-global-inventory';
import type { IGlobalTargetFacts } from '../interfaces/global-packages.runtime';
import { snapshotGlobalPreviewFacts } from './global-preview';
import { verifyPnpm10GlobalPostcondition } from './pnpm10-global-postcondition';

describe('pnpm 10 semantic postcondition', () => {
  it.each(['change', 'remove'] as const)(
    'accepts coherent synthetic %s with recomputed private hoists',
    async (action) => {
      const a = await pnpm10PrivateHoistFixture(
        false,
        action === 'remove' ? 'change' : undefined,
      );
      const b = await pnpm10PrivateHoistFixture(false, action);
      const previous = await readPnpm10GlobalInventory(a.location, a.deps);
      const next = await readPnpm10GlobalInventory(b.location, b.deps);
      const before = snapshotGlobalPreviewFacts({
        location: a.location,
        current: previous.facts.find((dep) => dep.name === 'wrap-ansi')!,
        target:
          action === 'change'
            ? {
                name: 'wrap-ansi',
                version: '8.0.0',
                requestedVersion: '8.0.0',
                bins: [],
                integrity: 'TEST',
                manifestHash: 'TEST',
                deprecated: false,
                engines: null,
              }
            : null,
        binOwners: previous.binOwners,
        pnpm10Inventory: previous.pnpm10Inventory!,
      });
      const modules = (h: typeof a) =>
        h.entries.get(
          `${h.location.globalRoot}\\node_modules\\.modules.yaml`.toLowerCase(),
        )!.text;
      expect(modules(a)).not.toBe(modules(b));
      expect(next.ownershipComplete).toBe(true);
      expect(
        verifyPnpm10GlobalPostcondition(before, next, {
          action,
          package: 'wrap-ansi',
        }),
      ).toBe(true);
      if (action === 'change') {
        before.target!.version = '8.1.0';
        expect(
          verifyPnpm10GlobalPostcondition(before, next, {
            action,
            package: 'wrap-ansi',
          }),
        ).toBe(false);
      }
    },
  );
  async function setup(from = 4, to = 5) {
    const a = await pnpm10InventoryFixture(from),
      b = await pnpm10InventoryFixture(to);
    const prev = await readPnpm10GlobalInventory(a.location, a.deps);
    const next = await readPnpm10GlobalInventory(b.location, b.deps);
    const target: IGlobalTargetFacts = {
      name: 'is-number',
      version: '6.0.0',
      requestedVersion: '6.0.0',
      bins: [],
      integrity: 'TEST',
      manifestHash: 'TEST',
      deprecated: false,
      engines: null,
    };
    const before = snapshotGlobalPreviewFacts({
      location: a.location,
      current: prev.facts.find((d) => d.name === 'is-number')!,
      target,
      binOwners: prev.binOwners,
      pnpm10Inventory: prev.pnpm10Inventory!,
    });
    return { before, next };
  }
  it('accepts target changes with identical neighbours and rewritten identities', async () => {
    const { before, next } = await setup();
    next.pnpm10Inventory!.project.dependencies.find(
      (d) => d.name === 'semver',
    )!.shims[0].file.stat.ino = 999;
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'change',
        package: 'is-number',
      }),
    ).toBe(true);
  });
  it.each([
    'spec',
    'version',
    'realPath',
    'bins',
    'shim',
    'new',
    'target-spec',
    'target-version',
  ])('refuses semantic drift %s', async (kind) => {
    const { before, next } = await setup();
    const deps = next.pnpm10Inventory!.project.dependencies;
    const neighbour = deps.find((d) => d.name === 'semver')!;
    if (kind === 'spec') neighbour.spec = '^7.7.3';
    if (kind === 'version') neighbour.version = '7.7.4';
    if (kind === 'realPath') neighbour.realPath += '-changed';
    if (kind === 'bins') neighbour.bins = [];
    if (kind === 'shim') neighbour.shims[0].sha256 = 'changed';
    if (kind === 'new')
      next.pnpm10Inventory!.project.dependencies = [
        ...deps,
        { ...neighbour, name: 'test-new' },
      ];
    if (kind === 'target-spec')
      deps.find((d) => d.name === 'is-number')!.spec = '^6.0.0';
    if (kind === 'target-version')
      deps.find((d) => d.name === 'is-number')!.version = '5.0.0';
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'change',
        package: 'is-number',
      }),
    ).toBe(false);
  });
  it('accepts removing a bin package only when all its slots disappear', async () => {
    const { before, next } = await setup(6, 7);
    before.current = { ...before.current, name: 'semver' };
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'remove',
        package: 'semver',
      }),
    ).toBe(true);
    next.pnpm10Inventory!.binSlots = [
      ...next.pnpm10Inventory!.binSlots,
      before.pnpm10Inventory.binSlots.find((s) => s.owner === 'semver')!,
    ];
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'remove',
        package: 'semver',
      }),
    ).toBe(false);
  });
  it('accepts an empty bin directory after removing the last binary', async () => {
    const { before, next } = await setup(1, 9);
    next.pnpm10Inventory!.binSlots = [];
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'remove',
        package: 'semver',
      }),
    ).toBe(true);
  });
  it('rejects linked-neighbour shim or link drift after removing semver', async () => {
    const { before, next } = await setup(6, 7);
    const linked = next.pnpm10Inventory!.project.dependencies.find(
      (d) => d.linked,
    )!;
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'remove',
        package: 'semver',
      }),
    ).toBe(true);
    linked.shims[0].sha256 = 'TEST changed';
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'remove',
        package: 'semver',
      }),
    ).toBe(false);
  });
  it('checks target bin declarations and old-only slots after change', async () => {
    const { before, next } = await setup(1, 1);
    const target = next.pnpm10Inventory!.project.dependencies[0];
    before.target = {
      ...before.target,
      name: 'semver',
      version: '7.7.3',
      bins: [{ name: 'test-new-bin', target: 'cli.js' }],
    };
    target.bins = [...before.target.bins];
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(false);
    next.pnpm10Inventory!.binSlots = next.pnpm10Inventory!.binSlots.filter(
      (s) => s.owner !== 'semver',
    );
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(false);
    target.bins = [];
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(false);
  });
  it('requires owned target shim hashes even if a supplied completeness flag is true', async () => {
    const { before, next } = await setup(1, 1);
    before.target = {
      ...before.target,
      name: 'semver',
      version: '7.7.3',
      bins: [...next.packages[0].bins],
    };
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(true);
    next.pnpm10Inventory!.binSlots = next.pnpm10Inventory!.binSlots.filter(
      (s) => s.owner !== 'semver',
    );
    expect(
      verifyPnpm10GlobalPostcondition(before, next, {
        action: 'change',
        package: 'semver',
      }),
    ).toBe(false);
  });
});
