import 'reflect-metadata';
import { pnpm10InventoryFixture } from '../__fixtures__/pnpm10/inventory';
import { P10 } from '../__fixtures__/pnpm10/config';
import { config10Fixture } from '../__fixtures__/pnpm10/config';
import { readPnpm10GlobalConfig } from '../config/pnpm10-global-config';
import { readPnpm10GlobalInventory } from '../discovery/pnpm10-global-inventory';
import { expectGlobalReason } from '../__fixtures__/global-adapters';
import {
  buildPnpm10GlobalCommand,
  buildPnpm10GlobalQuery,
} from './pnpm10-global-command';
import {
  buildGlobalCommand,
  buildGlobalQuery,
  isPnpmGlobalVersion,
} from './global-command';

describe('pnpm 10 pinned commands', () => {
  async function setup() {
    const h = await pnpm10InventoryFixture(2);
    const inventory = await readPnpm10GlobalInventory(h.location, h.deps);
    return {
      ...h,
      input: {
        location: h.location,
        environment: h.environment,
        pnpm10Inventory: inventory.pnpm10Inventory,
        action: 'change' as const,
        packageName: 'semver',
        exactVersion: '7.7.4',
        publicRegistry: true,
      },
    };
  }
  it('matches F5b add, remove and list argv without pm-on-fail', async () => {
    const { input, location } = await setup();
    const prefix = [
      location.tool.entry,
      '--dir',
      P10.cwd,
      '--config.manage-package-manager-versions=false',
    ];
    expect(buildPnpm10GlobalCommand(input).args).toEqual([
      ...prefix,
      'add',
      '--global',
      '--global-dir',
      location.globalDir,
      '--global-bin-dir',
      P10.home,
      '--store-dir',
      P10.store,
      '--registry',
      'https://registry.npmjs.org',
      '--reporter=append-only',
      '--',
      'semver@7.7.4',
    ]);
    expect(
      buildPnpm10GlobalCommand({
        ...input,
        action: 'remove',
        exactVersion: null,
        publicRegistry: false,
      }).args,
    ).toEqual([
      ...prefix,
      'remove',
      '--global',
      '--global-dir',
      location.globalDir,
      '--store-dir',
      P10.store,
      '--reporter=append-only',
      '--',
      'semver',
    ]);
    expect(
      buildPnpm10GlobalQuery({
        manager: 'pnpm',
        tool: location.tool,
        cwd: location.cwd,
        environment: input.environment,
        captured: {},
        query: 'list',
        pnpm10: location.pnpm10,
      }).args,
    ).toEqual([
      ...prefix,
      'list',
      '--global',
      '--global-dir',
      location.globalDir,
      '--depth=0',
      '--json',
    ]);
  });
  it('restores only validated selectors and original PATH; strips credentials and NODE_PATH', async () => {
    const { input, location } = await setup();
    const command = buildPnpm10GlobalCommand({
      ...input,
      environment: {
        ...input.environment,
        NODE_PATH: 'E:\\TEST\\injection',
        npm_config_token: 'TEST-secret',
        pnpm_config_global_dir: 'E:\\TEST\\other',
        HOME: 'E:\\TEST\\drift',
        PNPM_HOME: 'E:\\TEST\\drift',
      },
    });
    expect(command).toMatchObject({
      shell: false,
      extendEnv: false,
      stdin: 'ignore',
    });
    expect(command.env.PATH).toBe(location.pnpm10.originalPath.join(';'));
    expect(command.env.CI).toBe('1');
    for (const [key, value] of Object.entries(location.pnpm10.selectors))
      expect(command.env[key]).toBe(value);
    expect(command.env.HOME).toBeUndefined();
    expect(command.env.NODE_PATH).toBeUndefined();
    expect(command.env.npm_config_token).toBeUndefined();
    expect(command.env.pnpm_config_global_dir).toBeUndefined();
    location.pnpm10 = {
      ...location.pnpm10,
      selectors: { USERPROFILE: P10.profile, LOCALAPPDATA: P10.local },
    };
    expect(buildPnpm10GlobalCommand(input).env.PNPM_HOME).toBeUndefined();
  });
  it('requires the corroborated inventory store', async () => {
    const { input } = await setup();
    await expectGlobalReason(
      () => buildPnpm10GlobalCommand({ ...input, pnpm10Inventory: undefined }),
      'INVENTORY_FAILED',
    );
  });
  it('reproduces normalized npm path selectors using the spelling pnpm consumes', async () => {
    const h = config10Fixture({
      PNPM_HOME: undefined,
      npm_config_global_bin_dir: 'D:\\TEST\\separate-bin',
      PATH: 'D:\\TEST\\separate-bin',
      npm_config_cache_dir: 'D:\\TEST\\cache',
      npm_config_state_dir: 'D:\\TEST\\state',
      npm_config_store_dir: 'D:\\TEST\\store',
      npm_config_global_dir: 'D:\\TEST\\global',
    });
    h.put('D:\\TEST\\separate-bin', { directory: true });
    const config = await readPnpm10GlobalConfig(h.deps);
    const c = buildPnpm10GlobalQuery({
      manager: 'pnpm',
      tool: h.deps.tool,
      cwd: P10.cwd,
      environment: h.environment,
      captured: {},
      query: 'list',
      pnpm10: config,
    });
    expect(c.env.npm_config_global_bin_dir).toBe(config.binDir);
    expect(c.env.npm_config_cache_dir).toBe(config.cacheDir);
    expect(c.env.npm_config_state_dir).toBe(config.stateDir);
    expect(c.env.npm_config_store_dir).toBe('D:\\TEST\\store');
    expect(c.env.npm_config_global_dir).toBe(config.globalDir);
    expect(Object.keys(c.env).some((k) => /^pnpm_home$/i.test(k))).toBe(false);
  });
  it('dispatches both existing builders to the verified pnpm 10 adapter', async () => {
    const { input, location } = await setup();
    expect(buildGlobalCommand(input)).toEqual(buildPnpm10GlobalCommand(input));
    const query = {
      manager: 'pnpm' as const,
      tool: location.tool,
      cwd: location.cwd,
      environment: input.environment,
      captured: {},
      query: 'list' as const,
      pnpm10: location.pnpm10,
    };
    expect(buildGlobalQuery(query)).toEqual(buildPnpm10GlobalQuery(query));
  });
  it.each([
    ['10.34.9', true],
    ['11.22.0', true],
    ['12.0.0', true],
    ['12.21.0', true],
    ['9.15.9', false],
    ['13.0.0', false],
    ['10.34.9-rc.1', false],
    ['12.0.0-rc.1', false],
    // pnpm 11 keeps its pre-VC4 global gate (major 11, prereleases included),
    // matching the runner policy; pnpm 10 and 12 are stable-only.
    ['11.23.0-rc.1', true],
  ])('shares the global version gate %s', (version, accepted) => {
    expect(isPnpmGlobalVersion(String(version))).toBe(accepted);
  });
});
