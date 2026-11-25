import 'reflect-metadata';
import { win32 } from 'node:path';
import { AppException } from '@/common/exceptions/app.exception';
import {
  assertGlobalLocationsDistinct,
  createGlobalProbeSpawn,
  discoverGlobalLocation,
  runGlobalProbe,
} from '@/global-packages/discovery/global-location';
import type { IGlobalLocationDeps } from '@/global-packages/discovery/global-location';
import {
  expectGlobalReason,
  TEST_NPM_VERSIONS,
  memoryFs,
  probeResult,
  TEST_PATHS as P,
  testSpawn,
  testLocation,
  testTool,
} from '@/global-packages/__fixtures__/global-adapters';
import type {
  IGlobalCommand,
  IGlobalProbeResult,
} from '@/global-packages/interfaces/global-packages.runtime';
import * as runnerTools from '@/npm-runner/toolchain/runner-tool';
import {
  PNPM_TEST_PATHS as Q,
  pnpmLocation,
} from '@/global-packages/__fixtures__/pnpm11/facts';
import { pnpm12Tool } from '@/global-packages/__fixtures__/pnpm12/facts';
import { readGlobalInventory } from '@/global-packages/discovery/global-inventory';
import { config10Fixture, P10 } from '../__fixtures__/pnpm10/config';

describe('bounded cancellable probe boundary', () => {
  const command: IGlobalCommand = {
    file: P.node,
    args: [testTool('npm').entry!, 'root', '--global'],
    cwd: P.cwd,
    env: { CI: '1' },
  };
  it.each(['path', 'list'] as const)(
    'applies finite launch and capture options to %s',
    async (kind) => {
      const spawn = testSpawn();
      const signal = new AbortController().signal;
      await runGlobalProbe(command, kind, signal, spawn);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith(
        command.file,
        command.args,
        expect.objectContaining({
          cwd: P.cwd,
          env: command.env,
          shell: false,
          extendEnv: false,
          stdin: 'ignore',
          encoding: 'buffer',
          reject: false,
          timeout: 30_000,
          maxBuffer: {
            stdout: (kind === 'path' ? 1 : 8) * 1024 * 1024,
            stderr: 64 * 1024,
          },
        }),
      );
      expect(spawn.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
    },
  );
  it.each([
    ['path', 1024 * 1024 + 1],
    ['list', 8 * 1024 * 1024 + 1],
  ] as const)('rejects oversized %s output', async (kind, size) => {
    const spawn = testSpawn().mockResolvedValue(
      probeResult({}, { stdout: Buffer.alloc(size) }),
    );
    await expectGlobalReason(
      () => runGlobalProbe(command, kind, new AbortController().signal, spawn),
      'LIMIT_EXCEEDED',
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it('refuses stderr overflow rather than accepting partial capture', async () => {
    const spawn = testSpawn().mockResolvedValue(
      probeResult({}, { stderr: Buffer.alloc(64 * 1024 + 1) }),
    );
    await expectGlobalReason(
      () =>
        runGlobalProbe(command, 'path', new AbortController().signal, spawn),
      'LIMIT_EXCEEDED',
    );
  });
  it('does not expose ANSI, control characters or raw probe stderr in errors', async () => {
    const spawn = testSpawn().mockResolvedValue(
      probeResult(
        {},
        {
          exitCode: 1,
          stderr: Buffer.from('\u001b[31mTEST-private-config\u0000\u001b[0m'),
        },
      ),
    );
    let caught: unknown;
    try {
      await runGlobalProbe(
        command,
        'path',
        new AbortController().signal,
        spawn,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    expect((caught as AppException).details).toMatchObject({
      reason: 'COMMAND_FAILED',
    });
    expect(JSON.stringify(caught)).not.toMatch(
      /TEST-private-config|\\u001b|\\u0000/,
    );
  });
  it('refuses unconfirmed termination', async () => {
    const spawn = testSpawn().mockResolvedValue(
      probeResult({}, { terminationVerified: false }),
    );
    await expectGlobalReason(
      () =>
        runGlobalProbe(command, 'path', new AbortController().signal, spawn),
      'TERMINATION_UNCONFIRMED',
    );
  });
  it('does not spawn after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('TEST cancelled'));
    const spawn = testSpawn();
    await expect(
      runGlobalProbe(command, 'path', controller.signal, spawn),
    ).rejects.toThrow('TEST cancelled');
    expect(spawn).not.toHaveBeenCalled();
  });
  it('passes in-flight abort to the real probe and consumes rejection without retry', async () => {
    const controller = new AbortController();
    const spawn = testSpawn().mockImplementation(
      (_file, _args, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new Error('TEST aborted')),
            { once: true },
          );
        }),
    );
    const result = runGlobalProbe(command, 'path', controller.signal, spawn);
    const rejected = expect(result).rejects.toThrow();
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe.each(TEST_NPM_VERSIONS)('verified location (npm %s)', (v) => {
  const controller = () => new AbortController();
  function setup() {
    const memory = memoryFs();
    for (const value of Object.values(P))
      memory.put(value, { directory: true });
    memory.put(P.node, { text: 'TEST node identity' });
    memory.put(P.userconfig, { text: '' });
    memory.put(P.globalconfig, { text: '' });
    memory.put(win32.join(P.prefix, 'node_modules'), { directory: true });
    memory.put(win32.join(P.global, 'node_modules'), { directory: true });
    const outputs = new Map<string, string>([
      ['prefix', P.prefix],
      ['root:npm', win32.join(P.prefix, 'node_modules')],
      ['root:pnpm', win32.join(P.global, 'node_modules')],
      ['global-dir', P.global],
      ['bin', P.bin],
      ['store', P.store],
      ['userconfig', P.userconfig],
      ['globalconfig', P.globalconfig],
      ['cache', P.cache],
    ]);
    const spawn = testSpawn().mockImplementation((_file, args) => {
      const manager = args[0] === testTool('npm').entry ? 'npm' : 'pnpm';
      const key = args.includes('root')
        ? `root:${manager}`
        : args.includes('bin')
          ? 'bin'
          : args.includes('store')
            ? 'store'
            : args.at(-1)!;
      return Promise.resolve(
        probeResult(null, {
          stdout: Buffer.from(`${outputs.get(key) ?? ''}\r\n`),
        }),
      );
    });
    const makeDirectory = jest
      .fn<Promise<void>, [string]>()
      .mockImplementation((path) => {
        memory.put(path, { directory: true });
        return Promise.resolve();
      });
    const deps: IGlobalLocationDeps = {
      fs: memory.fs,
      environment: { USERPROFILE: P.profile, PATH: 'D:\\TEST\\AppData\\npm' },
      execPath: P.node,
      paths: {
        cacheDir: win32.dirname(P.cwd),
        appInstallDir: P.app,
        sourceCheckoutDir: P.source,
        dataDir: P.data,
      },
      scannedProjectPaths: ['D:\\TEST\\project'],
      signal: controller().signal,
      spawn,
      makeDirectory,
    };
    return { ...memory, deps, spawn, outputs, makeDirectory };
  }
  beforeEach(() => {
    jest
      .spyOn(runnerTools, 'resolveRunnerTool')
      .mockImplementation((manager) => {
        if (manager !== 'npm' && manager !== 'pnpm')
          throw new Error('TEST unsupported manager');
        return Promise.resolve(
          testTool(manager, manager === 'npm' ? v : undefined),
        );
      });
    jest
      .spyOn(runnerTools, 'revalidateRunnerTool')
      .mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  // TEST không phải yêu cầu nghiệp vụ. Settlement includes process verification.
  function controlledProbes(spawn: ReturnType<typeof testSpawn>) {
    const original = spawn.getMockImplementation()!;
    const probes: {
      query: string;
      signal: AbortSignal;
      stopped: boolean;
      complete(patch?: Partial<IGlobalProbeResult>): Promise<void>;
    }[] = [];
    let active = 0;
    let peak = 0;
    spawn.mockImplementation((file, args, options) => {
      active++;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        const probe = {
          query: args.includes('root') ? 'root' : args.at(-1)!,
          signal: options.signal,
          stopped: false,
          async complete(patch: Partial<IGlobalProbeResult> = {}) {
            const result = await original(file, args, options);
            options.signal.removeEventListener('abort', abort);
            active--;
            resolve({ ...result, ...patch });
          },
        };
        const abort = () => {
          probe.stopped = true;
        };
        options.signal.addEventListener('abort', abort, { once: true });
        probes.push(probe);
      });
    });
    return { probes, active: () => active, peak: () => peak };
  }
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('keeps two full probe lifecycles in flight and preserves results despite reverse completion', async () => {
    const { deps, spawn } = setup();
    const expected = await discoverGlobalLocation('npm', deps);
    spawn.mockClear();
    const h = controlledProbes(spawn);
    const pending = discoverGlobalLocation('npm', deps);
    await tick();
    expect(h.probes.map(({ query }) => query)).toEqual(['prefix', 'root']);
    expect(h.active()).toBe(2);
    // Keep prefix alive while the other slot completes all remaining probes.
    for (let i = 1; i < 5; i++) {
      await h.probes[i].complete();
      await tick();
      expect(h.active()).toBe(i === 4 ? 1 : 2);
      expect(h.probes).toHaveLength(Math.min(i + 2, 5));
    }
    await h.probes[0].complete();
    // Fixture stat objects carry fresh function instances per run; compare the data.
    const plain = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value)) as unknown;
    expect(plain(await pending)).toEqual(plain(expected));
    expect(h.probes.map(({ query }) => query)).toEqual([
      'prefix',
      'root',
      'userconfig',
      'globalconfig',
      'cache',
    ]);
    expect(h.peak()).toBe(2);
    expect(h.active()).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(5);
  });

  it('stops probe 3 when probe 2 fails, waits for verification, and never starts probe 4', async () => {
    const { deps, spawn } = setup();
    const h = controlledProbes(spawn);
    let settled = false;
    const result = discoverGlobalLocation('npm', deps).catch(
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await tick();
    await h.probes[0].complete();
    await tick();
    expect(h.probes.map(({ query }) => query)).toEqual([
      'prefix',
      'root',
      'userconfig',
    ]);
    await h.probes[1].complete({ timedOut: true });
    await tick();
    expect(h.probes[2].stopped).toBe(true);
    expect(h.probes).toHaveLength(3);
    expect(settled).toBe(false);
    await h.probes[2].complete({ exitCode: null });
    expect(await result).toMatchObject({ details: { reason: 'TIMED_OUT' } });
    expect(h.active()).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('cancels both launched probes and waits for both verification results', async () => {
    const { deps, spawn } = setup();
    const abort = controller();
    deps.signal = abort.signal;
    const h = controlledProbes(spawn);
    let settled = false;
    const result = discoverGlobalLocation('npm', deps).catch(
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await tick();
    expect(h.probes).toHaveLength(2);
    const reason = new Error('TEST cancel npm discovery');
    abort.abort(reason);
    expect(h.probes.every((probe) => probe.stopped)).toBe(true);
    await h.probes[1].complete({ exitCode: null });
    await tick();
    expect(settled).toBe(false);
    await h.probes[0].complete({ exitCode: null });
    expect(await result).toBe(reason);
    expect(h.active()).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('chooses the earlier query error when two probes fail together', async () => {
    const { deps, spawn } = setup();
    spawn.mockImplementation((_file, args) =>
      Promise.resolve(
        probeResult(null, {
          stdout: Buffer.from('TEST invalid path'),
          ...(args.includes('root') ? { exitCode: 1 } : {}),
        }),
      ),
    );
    await expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'LOCATION_AMBIGUOUS',
    );
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('preserves query order when a later failure settles first in the same turn', async () => {
    const { deps, spawn } = setup();
    const h = controlledProbes(spawn);
    const pending = expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'LOCATION_AMBIGUOUS',
    );
    await tick();
    await Promise.all([
      h.probes[1].complete({ timedOut: true }),
      h.probes[0].complete({ stdout: Buffer.from('TEST invalid prefix') }),
    ]);
    await pending;
    expect(h.active()).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it.each(['npm'] as const)(
    'uses M6 resolver and derives canonical %s tuple',
    async (manager) => {
      const { deps, spawn } = setup();
      const location = await discoverGlobalLocation(manager, deps);
      expect(jest.mocked(runnerTools.resolveRunnerTool)).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          execPath: P.node,
          platform: 'win32',
          projectPaths: deps.scannedProjectPaths,
        }),
        deps.fs,
      );
      expect(location).toMatchObject({
        manager,
        tool: testTool(manager, v),
        cwd: P.cwd,
        globalRoot: win32.join(P.prefix, 'node_modules'),
        binDir: P.prefix,
        userConfig: P.userconfig,
        globalConfig: P.globalconfig,
      });
      expect(location.configIdentities).toHaveLength(2);
      expect(location.configIdentities[0].sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(spawn).toHaveBeenCalledTimes(5);
      for (const [file, args, options] of spawn.mock.calls) {
        expect(file).toBe(P.node);
        expect(args[0]).toBe(testTool(manager).entry);
        expect(args).not.toContain('--version');
        expect(options.cwd).toBe(P.cwd);
        expect(options).toMatchObject({
          shell: false,
          extendEnv: false,
          stdin: 'ignore',
        });
      }
    },
  );
  it('protects distributions and the Node file, never the Node directory', async () => {
    const { deps } = setup();
    const location = await discoverGlobalLocation('npm', deps);
    expect([...location.protectedPaths].sort()).toEqual(
      [P.npm, P.pnpm, P.node, P.app, P.source, P.data].sort(),
    );
    expect(location.protectedPaths).not.toContain(win32.dirname(P.node));
  });
  it('allows a prefix inside the Node install directory', async () => {
    const { deps, outputs, put } = setup();
    const prefix = win32.dirname(P.node);
    outputs.set('prefix', prefix);
    outputs.set('root:npm', win32.join(prefix, 'node_modules'));
    put(win32.join(prefix, 'node_modules'), { directory: true });
    expect((await discoverGlobalLocation('npm', deps)).prefix).toBe(prefix);
  });
  it.each([
    'TOOL_NOT_FOUND',
    'TOOL_VERSION_MISMATCH',
    'TOOL_LAYOUT_UNSUPPORTED',
  ] as const)(
    'propagates %s and never probes a shim or fallback',
    async (reason) => {
      const { deps, spawn } = setup();
      jest
        .mocked(runnerTools.resolveRunnerTool)
        .mockRejectedValue(runnerTools.runnerFailure(reason));
      await expectGlobalReason(
        () => discoverGlobalLocation('npm', deps),
        reason,
      );
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it.each([
    '',
    'undefined',
    'null',
    'D:\\TEST\\one\nD:\\TEST\\two',
    'relative',
    '\\\\server\\share',
    '\\\\?\\D:\\TEST',
    'D:\\',
    P.profile,
    'C:\\Windows\\Temp',
    P.app,
    P.source,
    P.data,
    'D:\\TEST\\project',
    'D:\\TEST\\project\\global',
  ])('refuses unsafe or ambiguous prefix %p', async (prefix) => {
    const { deps, outputs, put } = setup();
    outputs.set('prefix', prefix);
    outputs.set('root:npm', win32.join(prefix, 'node_modules'));
    put(prefix, { directory: true });
    put(win32.join(prefix, 'node_modules'), { directory: true });
    await expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'LOCATION_AMBIGUOUS',
    );
  });
  it('refuses a global root that contradicts the returned prefix', async () => {
    const { deps, outputs } = setup();
    outputs.set('root:npm', 'D:\\TEST\\other\\node_modules');
    await expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'LOCATION_AMBIGUOUS',
    );
  });
  it('rejects redirected ancestors even when a leaf realpath appears safe', async () => {
    const { deps, put } = setup();
    put('D:\\TEST', { directory: true, link: true, real: 'E:\\TEST' });
    await expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'LOCATION_AMBIGUOUS',
    );
  });
  it('never creates a missing global layout', async () => {
    const { deps, outputs, makeDirectory } = setup();
    outputs.set('prefix', 'D:\\TEST\\missing');
    outputs.set('root:npm', 'D:\\TEST\\missing\\node_modules');
    await expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'LOCATION_AMBIGUOUS',
    );
    expect(makeDirectory.mock.calls.every(([path]) => path === P.cwd)).toBe(
      true,
    );
  });
  it('rejects a nonempty neutral cwd rather than cleaning it', async () => {
    const { deps, readdir } = setup();
    readdir.mockResolvedValue(['package.json']);
    await expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'CONFIG_UNSUPPORTED',
    );
  });
  it.each(['package.json', '.npmrc', 'pnpm-workspace.yaml', '.pnpmfile.cjs'])(
    'rejects a project/config/plugin ancestor containing %s',
    async (name) => {
      const { deps, put, spawn } = setup();
      put(win32.join(win32.dirname(P.cwd), name), {
        text: 'TEST unexpected ancestor',
      });
      await expectGlobalReason(
        () => discoverGlobalLocation('npm', deps),
        'CONFIG_UNSUPPORTED',
      );
      expect(spawn).not.toHaveBeenCalled();
    },
  );
  it('checks cancellation before discovery', async () => {
    const { deps, spawn } = setup();
    const abort = controller();
    abort.abort(new Error('TEST stop'));
    deps.signal = abort.signal;
    await expect(discoverGlobalLocation('npm', deps)).rejects.toThrow(
      'TEST stop',
    );
    expect(spawn).not.toHaveBeenCalled();
  });
  it('preserves a resolver identity change and never starts a probe', async () => {
    const { deps, spawn } = setup();
    jest
      .mocked(runnerTools.revalidateRunnerTool)
      .mockRejectedValue(runnerTools.runnerFailure('INPUT_CHANGED'));
    await expectGlobalReason(
      () => discoverGlobalLocation('npm', deps),
      'INPUT_CHANGED',
    );
    expect(spawn).not.toHaveBeenCalled();
  });
  it('stops discovery after a cancellation at a probe await boundary', async () => {
    const { deps, spawn } = setup();
    const abort = controller();
    deps.signal = abort.signal;
    spawn.mockImplementationOnce(() => {
      abort.abort(new Error('TEST cancelled after probe'));
      return Promise.resolve(
        probeResult(null, { stdout: Buffer.from(P.prefix) }),
      );
    });
    await expect(discoverGlobalLocation('npm', deps)).rejects.toThrow(
      'TEST cancelled after probe',
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it.each([P.userconfig, P.globalconfig])(
    'refuses a redirected config %s',
    async (path) => {
      const { deps, put, open } = setup();
      put(path, { link: true, real: 'E:\\TEST\\outside.npmrc' });
      await expectGlobalReason(
        () => discoverGlobalLocation('npm', deps),
        'CONFIG_UNSUPPORTED',
      );
      expect(
        open.mock.calls.some(([opened]) => opened.startsWith('E:\\')),
      ).toBe(false);
    },
  );
  it('omits source-checkout protection only when there is no source checkout', async () => {
    const { deps } = setup();
    deps.paths.sourceCheckoutDir = null;
    const result = await discoverGlobalLocation('npm', deps);
    expect(result.protectedPaths).not.toContain(P.source);
    expect(result.protectedPaths).toEqual(
      expect.arrayContaining([P.npm, P.pnpm, P.node, P.app, P.data]),
    );
  });

  function setupPnpm() {
    const h = setup();
    h.deps.environment = {
      USERPROFILE: Q.profile,
      PNPM_HOME: Q.home,
      XDG_CONFIG_HOME: 'D:\\TEST\\xdg',
      PATH: `${Q.bin};C:\\Program Files\\nodejs`,
    };
    for (const path of [Q.home, Q.bin, Q.store])
      h.put(path, { directory: true });
    h.put(Q.yaml, {
      text: JSON.stringify({
        globalDir: Q.global,
        globalBinDir: Q.bin,
        storeDir: Q.store,
        npmrcAuthFile: Q.auth,
      }),
    });
    return h;
  }

  it('uses M6 resolver and static pnpm 11 config without discovery spawn', async () => {
    const h = setupPnpm();
    const location = await discoverGlobalLocation('pnpm', h.deps);
    expect(jest.mocked(runnerTools.resolveRunnerTool)).toHaveBeenCalledWith(
      'pnpm',
      expect.objectContaining({ execPath: P.node, platform: 'win32' }),
      h.deps.fs,
    );
    expect(location).toMatchObject({
      manager: 'pnpm',
      tool: testTool('pnpm'),
      prefix: null,
      globalDir: Q.global,
      globalRoot: Q.root,
      binDir: Q.bin,
      pnpm: { homeDir: Q.home, binDir: Q.bin, globalRoot: Q.root },
    });
    expect(location.configIdentities).toContainEqual(
      expect.objectContaining({
        file: expect.objectContaining({ path: Q.yaml }) as unknown,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      }),
    );
    expect(location.protectedPaths).toEqual(
      expect.arrayContaining([P.npm, P.pnpm, P.node, P.app, P.source, P.data]),
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('uses M6 resolver and static pnpm 12.21.0 config without discovery spawn', async () => {
    const h = setupPnpm();
    const p12 = pnpm12Tool('12.21.0');
    jest
      .mocked(runnerTools.resolveRunnerTool)
      .mockImplementation((manager) =>
        Promise.resolve(manager === 'pnpm' ? p12 : testTool(manager as 'npm')),
      );
    const location = await discoverGlobalLocation('pnpm', h.deps);
    expect(location).toMatchObject({
      manager: 'pnpm',
      tool: p12,
      prefix: null,
      globalDir: Q.global,
      globalRoot: Q.root,
      binDir: Q.bin,
      pnpm: { homeDir: Q.home, binDir: Q.bin, globalRoot: Q.root },
    });
    expect(location.protectedPaths).toEqual(
      expect.arrayContaining([
        P.npm,
        P.pnpm,
        p12.file,
        P.app,
        P.source,
        P.data,
      ]),
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it.each([
    '9.15.9',
    '12.0.0-alpha.1',
    '12.21.0-rc.1',
    '13.0.0',
    '10.34.9-rc.1',
  ])('refuses unsupported pnpm %s before any config reads', async (version) => {
    const h = setupPnpm();
    jest
      .mocked(runnerTools.resolveRunnerTool)
      .mockImplementation((manager) =>
        Promise.resolve(
          manager === 'pnpm' && version.startsWith('12.')
            ? pnpm12Tool(version)
            : testTool(
                manager as 'npm' | 'pnpm',
                manager === 'pnpm' ? version : undefined,
              ),
        ),
      );
    await expectGlobalReason(
      () => discoverGlobalLocation('pnpm', h.deps),
      'TOOL_VERSION_MISMATCH',
    );
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
  });

  function setup10(patch: NodeJS.ProcessEnv = {}) {
    const h = setup();
    const f = config10Fixture(patch);
    h.deps.fs = f.fs;
    h.deps.environment = f.environment;
    jest
      .mocked(runnerTools.resolveRunnerTool)
      .mockImplementation((manager) =>
        Promise.resolve(
          testTool(
            manager as 'npm' | 'pnpm',
            manager === 'pnpm' ? '10.34.9' : undefined,
          ),
        ),
      );
    return { ...h, ...f, deps: h.deps };
  }
  it('discovers pnpm 10 default H=B containing G and S, with store unproven until inventory', async () => {
    const h = setup10();
    const location = await discoverGlobalLocation('pnpm', h.deps);
    expect(location).toMatchObject({
      manager: 'pnpm',
      globalRoot: P10.root,
      globalDir: `${P10.home}\\global`,
      binDir: P10.home,
      storeDir: null,
      pnpm10: { homeDir: P10.home },
      userConfig: `${P10.profile}\\.npmrc`,
    });
    expect(location.pnpm).toBeUndefined();
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it.each(['bin-in-root', 'root-in-bin', 'store-in-root', 'store-in-bin'])(
    'refuses pnpm 10 overlap %s',
    async (kind) => {
      const h = setup10({
        ...(kind === 'bin-in-root'
          ? {
              npm_config_global_bin_dir: `${P10.root}\\bin`,
              PATH: `${P10.root}\\bin`,
            }
          : {}),
        ...(kind === 'root-in-bin'
          ? {
              npm_config_global_bin_dir: `${P10.home}\\global`,
              PATH: `${P10.home}\\global`,
            }
          : {}),
        ...(kind === 'store-in-root'
          ? { npm_config_store_dir: `${P10.root}\\store` }
          : {}),
        ...(kind === 'store-in-bin'
          ? {
              npm_config_global_bin_dir: 'D:\\TEST\\other',
              PATH: 'D:\\TEST\\other',
              npm_config_store_dir: 'D:\\TEST\\other\\store',
            }
          : {}),
      });
      for (const p of h.deps.environment.PATH!.split(';'))
        h.put(p, { directory: true });
      await expectGlobalReason(
        () => discoverGlobalLocation('pnpm', h.deps),
        'LOCATION_AMBIGUOUS',
      );
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    'TOOL_NOT_FOUND',
    'TOOL_VERSION_MISMATCH',
    'TOOL_LAYOUT_UNSUPPORTED',
    'INPUT_CHANGED',
  ] as const)(
    'propagates pnpm resolver failure %s with zero spawn',
    async (reason) => {
      const h = setupPnpm();
      if (reason === 'INPUT_CHANGED')
        jest
          .mocked(runnerTools.revalidateRunnerTool)
          .mockRejectedValue(runnerTools.runnerFailure(reason));
      else
        jest
          .mocked(runnerTools.resolveRunnerTool)
          .mockRejectedValue(runnerTools.runnerFailure(reason));
      await expectGlobalReason(
        () => discoverGlobalLocation('pnpm', h.deps),
        reason,
      );
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it('does not guess a pnpm global dir when a late selector disagrees with static config', async () => {
    const h = setupPnpm();
    h.deps.environment = {
      ...h.deps.environment,
      pnpm_config_global_dir: 'D:\\TEST\\other-global',
    };
    await expectGlobalReason(
      () => discoverGlobalLocation('pnpm', h.deps),
      'CONFIG_UNSUPPORTED',
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('refuses a pnpm bin override that disagrees with the static YAML bin', async () => {
    const h = setupPnpm();
    h.deps.environment = {
      ...h.deps.environment,
      pnpm_config_global_bin_dir: 'D:\\TEST\\other-bin',
    };
    await expectGlobalReason(
      () => discoverGlobalLocation('pnpm', h.deps),
      'CONFIG_UNSUPPORTED',
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it.each(['missing-bin', 'not-on-path', 'relative-path'] as const)(
    'reports unconfigured pnpm for %s without creating layout or spawning',
    async (kind) => {
      const h = setupPnpm();
      if (kind === 'missing-bin')
        h.entries.delete(win32.resolve(Q.bin).toLowerCase());
      else
        h.deps.environment = {
          ...h.deps.environment,
          PATH:
            kind === 'relative-path' ? 'pnpm-bin' : 'C:\\Program Files\\nodejs',
        };
      await expectGlobalReason(
        () => discoverGlobalLocation('pnpm', h.deps),
        'PNPM_GLOBAL_NOT_CONFIGURED',
      );
      expect(h.spawn).not.toHaveBeenCalled();
      expect(h.makeDirectory.mock.calls.every(([path]) => path === P.cwd)).toBe(
        true,
      );
    },
  );

  it('keeps configured pnpm with a missing root available and pins empty inventory absence', async () => {
    const h = setupPnpm();
    const location = await discoverGlobalLocation('pnpm', h.deps);
    expect(location.pnpm!.missingDirectoryPaths).toContain(Q.root);
    const result = await readGlobalInventory(location, h.deps);
    expect(result.packages).toEqual([]);
    expect(result.ownershipComplete).toBe(true);
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.makeDirectory.mock.calls.every(([path]) => path === P.cwd)).toBe(
      true,
    );
  });

  it.each([P.app, P.source, P.data, 'D:\\TEST\\project', 'C:\\Windows\\Temp'])(
    'applies pnpm scope protection to configured directory %s',
    async (path) => {
      const h = setupPnpm();
      h.put(Q.yaml, {
        text: JSON.stringify({ globalDir: path, globalBinDir: Q.bin }),
      });
      await expectGlobalReason(
        () => discoverGlobalLocation('pnpm', h.deps),
        'LOCATION_AMBIGUOUS',
      );
      expect(h.spawn).not.toHaveBeenCalled();
    },
  );

  it('refuses redirected pnpm root ancestors before reading inventory', async () => {
    const h = setupPnpm();
    h.put(Q.global, { directory: true, link: true, real: 'E:\\TEST\\outside' });
    await expectGlobalReason(
      () => discoverGlobalLocation('pnpm', h.deps),
      'LOCATION_AMBIGUOUS',
    );
    expect(h.open.mock.calls.some(([path]) => path.startsWith('E:\\'))).toBe(
      false,
    );
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('reports unconfigured pnpm 12 native binary while keeping npm discovery available and pnpm 12 protected', async () => {
    const h = setup();
    const p12 = pnpm12Tool('12.21.0');
    jest
      .mocked(runnerTools.resolveRunnerTool)
      .mockImplementation((manager) =>
        Promise.resolve(manager === 'pnpm' ? p12 : testTool('npm', v)),
      );
    await expectGlobalReason(
      () => discoverGlobalLocation('pnpm', h.deps),
      'PNPM_GLOBAL_NOT_CONFIGURED',
    );
    expect(h.spawn).not.toHaveBeenCalled();
    const npmLocation = await discoverGlobalLocation('npm', h.deps);
    expect(npmLocation.manager).toBe('npm');
    expect(npmLocation.protectedPaths).toContain(p12.packageDir);
  });

  it('allows createGlobalProbeSpawn for valid native pnpm 12 and refuses forged IRunnerTool launchers', async () => {
    const valid = pnpm12Tool('12.21.0');
    const deps = {
      processes: {
        capture: jest.fn(),
        descendants: jest.fn(),
        stopTree: jest.fn(),
        verifyGone: jest.fn(),
      },
      clock: {
        now: Date.now,
        setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
        clearTimeout: (handle: unknown) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    };
    const launch = jest.fn().mockReturnValue({
      settled: Promise.resolve({
        exitCode: 0,
        termination: 'verified',
        outputTruncated: false,
      }),
      stop: jest.fn(),
    });
    const probeOptions = {
      cwd: P.cwd,
      env: {},
      signal: new AbortController().signal,
      timeout: 5_000,
      maxBuffer: { stdout: 1024, stderr: 1024 },
      shell: false as const,
      extendEnv: false as const,
      stdin: 'ignore' as const,
      encoding: 'buffer' as const,
      reject: false as const,
    };
    const okSpawn = createGlobalProbeSpawn(valid, deps, { launch });
    const res = await okSpawn(valid.file, ['list', '--global'], probeOptions);
    expect(res.exitCode).toBe(0);
    expect(launch).toHaveBeenCalledTimes(1);

    const forgedTools = [
      { ...valid, file: 'D:\\TEST\\evil\\pnpm.exe' },
      { ...valid, file: `${valid.packageDir}-evil\\pnpm.exe` },
      { ...valid, file: P.node },
      { ...valid, file: 'pnpm.exe' },
      { ...valid, file: `${valid.packageDir}\\pnpm.cmd` },
      { ...valid, entry: `${valid.packageDir}\\bin\\pnpm.mjs` },
      { ...testTool('npm', v), entry: null },
    ];
    for (const bad of forgedTools) {
      const badSpawn = createGlobalProbeSpawn(bad, deps, { launch });
      await expectGlobalReason(
        () =>
          badSpawn(
            bad.file,
            bad.entry ? [bad.entry, 'list'] : ['list'],
            probeOptions,
          ),
        'TOOL_LAYOUT_UNSUPPORTED',
      );
    }
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

describe('cross-manager location ambiguity', () => {
  it('accepts distinct discovered roots and bins without changing their tuples', () => {
    const locations = [testLocation('npm'), pnpmLocation()];
    const before = JSON.stringify(locations);
    expect(() => assertGlobalLocationsDistinct(locations)).not.toThrow();
    expect(JSON.stringify(locations)).toBe(before);
  });
  it.each(['same-root', 'nested-root', 'same-bin'] as const)(
    'refuses %s across managers',
    async (kind) => {
      const npm = testLocation('npm');
      const pnpm = pnpmLocation();
      if (kind === 'same-root') pnpm.globalRoot = npm.globalRoot.toUpperCase();
      if (kind === 'nested-root')
        pnpm.globalRoot = win32.join(npm.globalRoot, 'nested');
      if (kind === 'same-bin') pnpm.binDir = npm.binDir;
      await expectGlobalReason(
        () => assertGlobalLocationsDistinct([npm, pnpm]),
        'LOCATION_AMBIGUOUS',
      );
    },
  );
});

describe('Yarn Classic real-Windows ancestor .yarnrc discovery (Tier B Finding 1)', () => {
  afterEach(() => jest.restoreAllMocks());

  function setupRealProfileLayout() {
    const profile = 'D:\\TEST\\Users\\alice';
    const local = `${profile}\\AppData\\Local`;
    const cacheDir = `${local}\\PkgSteward\\cache`;
    const cwd = `${cacheDir}\\global-packages-cwd`;
    const npmPrefix = 'D:\\TEST\\npm-global';
    const npmPkg = `${npmPrefix}\\node_modules\\yarn`;
    const npmEntry = `${npmPkg}\\bin\\yarn.js`;
    const yarnPrefix = 'D:\\TEST\\yarn-prefix';
    const mem = memoryFs();

    for (const d of [
      profile,
      `${profile}\\AppData`,
      local,
      `${local}\\PkgSteward`,
      cacheDir,
      cwd,
      npmPrefix,
      `${npmPrefix}\\node_modules`,
      npmPkg,
      `${npmPkg}\\bin`,
      yarnPrefix,
      `${yarnPrefix}\\bin`,
      `${local}\\Yarn`,
      `${local}\\Yarn\\Data`,
      `${local}\\Yarn\\Data\\global`,
      `${local}\\Yarn\\Data\\global\\node_modules`,
      `${local}\\Yarn\\Cache`,
    ]) {
      mem.put(d, { directory: true });
    }
    mem.put(P.node, { text: 'TEST node' });
    mem.put(win32.join(npmPkg, 'package.json'), {
      text: JSON.stringify({
        name: 'yarn',
        version: '1.22.22',
        bin: { yarn: 'bin/yarn.js' },
      }),
    });
    mem.put(npmEntry, { text: '// TEST yarn entry' });

    const deps: IGlobalLocationDeps = {
      fs: mem.fs,
      environment: {
        USERPROFILE: profile,
        LOCALAPPDATA: local,
        PATH: `${npmPrefix};${yarnPrefix}\\bin;C:\\Program Files\\nodejs`,
      },
      execPath: P.node,
      paths: {
        cacheDir,
        appInstallDir: P.app,
        sourceCheckoutDir: P.source,
        dataDir: `${local}\\PkgSteward`,
      },
      scannedProjectPaths: ['D:\\TEST\\project'],
      signal: new AbortController().signal,
      spawn: testSpawn(),
      makeDirectory: jest
        .fn<Promise<void>, [string]>()
        .mockResolvedValue(undefined),
    };
    return { ...mem, deps, profile, local, yarnPrefix };
  }

  it('allows USERPROFILE\\.yarnrc for yarn when cwd sits under AppData\\Local, and refuses intermediate .yarnrc or .yarnrc.yml', async () => {
    const h = setupRealProfileLayout();
    const userYarnrc = `${h.profile}\\.yarnrc`;
    h.put(userYarnrc, {
      text: `prefix "${h.yarnPrefix.replace(/\\/g, '\\\\')}"\n`,
    });

    const yarnLoc = await discoverGlobalLocation('yarn', h.deps);
    expect(yarnLoc.manager).toBe('yarn');
    expect(yarnLoc.prefix).toBe(h.yarnPrefix);
    expect(
      yarnLoc.configIdentities.some(
        (id) => id.file.path.toLowerCase() === userYarnrc.toLowerCase(),
      ),
    ).toBe(true);

    // npm and pnpm must also not fail on USERPROFILE\.yarnrc or .yarnrc.yml
    h.put(`${h.profile}\\.yarnrc.yml`, { text: 'nodeLinker: node-modules\n' });
    for (const d of [
      'D:\\TEST\\npm-prefix',
      'D:\\TEST\\npm-prefix\\node_modules',
      'D:\\TEST\\npm-cache',
    ]) {
      h.put(d, { directory: true });
    }
    jest
      .spyOn(runnerTools, 'resolveRunnerTool')
      .mockImplementation((manager) =>
        Promise.resolve(testTool(manager === 'pnpm' ? 'pnpm' : 'npm')),
      );
    jest
      .spyOn(runnerTools, 'revalidateRunnerTool')
      .mockResolvedValue(undefined);
    const npmSpawn = jest
      .fn<
        ReturnType<IGlobalLocationDeps['spawn']>,
        Parameters<IGlobalLocationDeps['spawn']>
      >()
      .mockImplementation((_f, args) => {
        const q = args.includes('root') ? 'root' : args.at(-1)!;
        const map: Record<string, string> = {
          prefix: 'D:\\TEST\\npm-prefix',
          root: 'D:\\TEST\\npm-prefix\\node_modules',
          userconfig: `${h.profile}\\.npmrc`,
          globalconfig: 'D:\\TEST\\npm-prefix\\etc\\npmrc',
          cache: 'D:\\TEST\\npm-cache',
        };
        return Promise.resolve(
          probeResult(null, { stdout: Buffer.from(`${map[q]}\n`) }),
        );
      });
    const npmLoc = await discoverGlobalLocation('npm', {
      ...h.deps,
      spawn: npmSpawn,
    });
    expect(npmLoc.manager).toBe('npm');

    // Yarn itself must still refuse .yarnrc.yml
    await expectGlobalReason(
      () => discoverGlobalLocation('yarn', h.deps),
      'CONFIG_UNSUPPORTED',
    );

    // Unexpected intermediate AppData\.yarnrc without .yarnrc.yml -> CONFIG_UNSUPPORTED for yarn
    const hInter = setupRealProfileLayout();
    hInter.put(`${hInter.local}\\.yarnrc`, { text: 'lastUpdateCheck 1\n' });
    await expectGlobalReason(
      () => discoverGlobalLocation('yarn', hInter.deps),
      'CONFIG_UNSUPPORTED',
    );
  });
});
