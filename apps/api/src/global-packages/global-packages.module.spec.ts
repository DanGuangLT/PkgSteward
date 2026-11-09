import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { win32 } from 'node:path';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import {
  createGlobalPackagesRuntime,
  GlobalPackagesModule,
} from '@/global-packages/global-packages.module';
import type { IGlobalRuntimeBindings } from '@/global-packages/global-packages.module';
import { GlobalPackagesService } from '@/global-packages/global-packages.service';
import { discoverGlobalLocation } from '@/global-packages/discovery/global-location';
import type { IGlobalProbeOptions } from '@/global-packages/interfaces/global-packages.runtime';
import {
  TEST_PATHS,
  testTool,
} from '@/global-packages/__fixtures__/global-adapters';
import {
  deferred,
  testProcess,
  testRuntime,
} from '@/global-packages/__fixtures__/global-lifecycle';
import type { launchRun } from '@/npm-runner/execution/runner-process';
import type { RunnerStopOutcome } from '@/platform/windows/windows-runner-process';

function bindings() {
  const f = testRuntime();
  f.fs.put(TEST_PATHS.node, { text: 'TEST inert Node executable' });
  f.fs.put(win32.join(TEST_PATHS.npm, 'package.json'), {
    text: JSON.stringify({
      name: 'npm',
      version: '11.17.0',
      bin: { npm: 'bin/npm-cli.js' },
    }),
  });
  f.fs.put(win32.join(TEST_PATHS.npm, 'bin', 'npm-cli.js'), {
    text: '// TEST inert entry',
  });
  const env = { PATH: 'D:\\TEST\\tools', TEST_VALUE: 'before' };
  const scanner = {
    getLatest: jest.fn(() => ({ projects: [{ path: 'D:\\TEST\\project' }] })),
  };
  const launchProcess = jest
    .fn<ReturnType<typeof launchRun>, Parameters<typeof launchRun>>()
    .mockReturnValue(f.child.process);
  const processes = {
    capture: jest.fn(() => Promise.resolve({ status: 'unknown' as const })),
    descendants: jest.fn(() => Promise.resolve({ status: 'unknown' as const })),
    stopTree: jest.fn(() => Promise.resolve('attempted' as const)),
    verifyGone: jest.fn(() => Promise.resolve('verified' as const)),
  };
  const input: IGlobalRuntimeBindings = {
    fs: f.runtime.fs,
    paths: f.runtime.paths,
    processes,
    scanner,
    gate: f.runtime.gate,
    audit: f.runtime.audit,
    config: new ConfigService({ NPM_COMMAND_TIMEOUT_MS: '' }),
    host: { platform: 'win32', execPath: TEST_PATHS.node, env },
    fetcher: f.fetcher,
    launchProcess,
  };
  return { f, input, env, scanner, launchProcess, processes };
}

describe('GlobalPackagesModule runtime bindings', () => {
  it('imports infrastructure without NpmRunnerModule or reader modules', () => {
    const imports = (Reflect.getMetadata('imports', GlobalPackagesModule) ??
      []) as { name?: string }[];
    const names = imports.map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'PlatformModule',
        'MutationGateModule',
        'ScannerModule',
      ]),
    );
    expect(names).not.toEqual(expect.arrayContaining(['NpmRunnerModule']));
    expect(names).not.toEqual(expect.arrayContaining(['ProjectsModule']));
    expect(names).not.toEqual(expect.arrayContaining(['DiskUsageModule']));
    expect(names).not.toEqual(expect.arrayContaining(['FileOpsModule']));
  });

  it('snapshots environment once and binds paths, fetch, clock, UUID, gate and audit', async () => {
    const b = bindings();
    const runtime = createGlobalPackagesRuntime(b.input);
    b.env.TEST_VALUE = 'after';
    expect(runtime.environment.TEST_VALUE).toBe('before');
    expect(Object.isFrozen(runtime.environment)).toBe(true);
    expect(runtime.platform).toBe('win32');
    expect(runtime.execPath).toBe(TEST_PATHS.node);
    expect(runtime.paths).toEqual(b.input.paths);
    expect(runtime.now()).toBeInstanceOf(Date);
    expect(Number.isFinite(runtime.monotonicNow())).toBe(true);
    expect(runtime.uuid()).toMatch(
      /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i,
    );
    expect(runtime.timeoutMs).toBeUndefined();
    expect(runtime.fetcher).toBe(b.f.fetcher);
    expect(runtime.scannedProjectPaths()).toEqual(['D:\\TEST\\project']);
    const token = runtime.gate.tryEnter();
    expect(token).not.toBeNull();
    expect(runtime.gate.tryEnter()).toBeNull();
    runtime.gate.leave(token!);
    expect(b.f.busy()).toBe(false);
    const record = {
      operation: 'global-packages.remove',
      operationId: 'TEST',
      phase: 'intent' as const,
      targets: ['TEST'],
      method: 'npm:remove',
      risk: { level: 'high' as const, codes: ['MACHINE_WIDE' as const] },
      result: 'intent',
    };
    await runtime.audit.append(record);
    expect(b.f.audit.mock.calls).toEqual([[record]]);
  });

  it.each([undefined, '', '1000', 1000])(
    'uses only the validated numeric command timeout: %p',
    (timeout) => {
      const b = bindings();
      b.input.config = new ConfigService({ NPM_COMMAND_TIMEOUT_MS: timeout });
      expect(createGlobalPackagesRuntime(b.input).timeoutMs).toBe(
        typeof timeout === 'number' ? timeout : undefined,
      );
    },
  );

  it('maps absent scans to no paths but does not conceal scanner failures', () => {
    const b = bindings();
    b.scanner.getLatest.mockImplementation(() => {
      throw new NotFoundException('Scan', 'TEST');
    });
    const runtime = createGlobalPackagesRuntime(b.input);
    expect(runtime.scannedProjectPaths()).toEqual([]);
    const failure = new AppException(
      500,
      'TEST scanner failed',
      'INTERNAL_SERVER_ERROR',
    );
    b.scanner.getLatest.mockImplementation(() => {
      throw failure;
    });
    expect(() => runtime.scannedProjectPaths()).toThrow(failure);
  });

  it('passes mutation argv/environment/callbacks to the M6 launch adapter with the Windows process adapter', async () => {
    const b = bindings();
    const runtime = createGlobalPackagesRuntime(b.input);
    const tool = testTool('npm');
    await runtime.resolveTool('npm', new AbortController().signal);
    const command = {
      file: tool.file,
      args: [tool.entry!, 'uninstall', '--global', '--', 'test-tool'],
      cwd: TEST_PATHS.cwd,
      env: { CI: '1', TEST_VALUE: 'child' },
    };
    const callbacks = {
      signal: new AbortController().signal,
      onOutput: jest.fn(),
      onExit: jest.fn(),
    };
    expect(runtime.launch(command, callbacks)).toBe(b.f.child.process);
    expect(b.launchProcess).toHaveBeenCalledTimes(1);
    const [actual, environment, listener, dependencies] =
      b.launchProcess.mock.calls[0];
    expect(actual).toMatchObject({
      file: command.file,
      args: command.args,
      cwd: command.cwd,
    });
    expect(environment).toEqual(command.env);
    expect(listener).toBe(callbacks);
    expect(dependencies.processes).toBe(b.processes);
  });

  it('retains an uncertain probe handle and retries stop verification without launching another probe', async () => {
    const b = bindings();
    const child = testProcess();
    b.launchProcess.mockReturnValue(child.process);
    const runtime = createGlobalPackagesRuntime(b.input);
    const options: IGlobalProbeOptions = {
      cwd: TEST_PATHS.cwd,
      env: {},
      signal: new AbortController().signal,
      timeout: 30_000,
      maxBuffer: { stdout: 1024, stderr: 1024 },
      shell: false,
      extendEnv: false,
      stdin: 'ignore',
      encoding: 'buffer',
      reject: false,
    };
    const pending = runtime.probe(
      TEST_PATHS.node,
      [testTool('npm').entry!, 'root', '--global'],
      options,
    );
    child.exit({ termination: 'unconfirmed' });
    expect((await pending).terminationVerified).toBe(false);
    expect(typeof runtime.verifyProbeTermination).toBe('function');
    child.stop.mockResolvedValueOnce('unconfirmed');
    expect(await runtime.verifyProbeTermination!()).toBe(false);
    child.stop.mockResolvedValueOnce('verified');
    expect(await runtime.verifyProbeTermination!()).toBe(true);
    expect(b.launchProcess).toHaveBeenCalledTimes(1);
    expect(child.stop).toHaveBeenCalledTimes(2);
    expect(await runtime.verifyProbeTermination!()).toBe(true);
    expect(child.stop).toHaveBeenCalledTimes(2);
  });

  it.each(['verified', 'unconfirmed'] as const)(
    'accounts for both cancelled discovery probes when termination is %s',
    async (termination) => {
      const b = bindings();
      b.f.fs.put(TEST_PATHS.cwd, { directory: true });
      const children = [testProcess(), testProcess()];
      const stops = children.map(() => deferred<RunnerStopOutcome>());
      children.forEach((child, index) => {
        child.stop.mockImplementationOnce(() => stops[index].promise);
      });
      b.launchProcess.mockImplementation((_command, _env, callbacks) => {
        const child = children[b.launchProcess.mock.calls.length - 1];
        // Model launchRun's abort -> stop -> verified settlement boundary.
        callbacks.signal.addEventListener(
          'abort',
          () => {
            void child.stop().then((outcome) => {
              child.exit({ exitCode: null, termination: outcome });
            });
          },
          { once: true },
        );
        return child.process;
      });
      const runtime = createGlobalPackagesRuntime(b.input);
      const abort = new AbortController();
      let settled = false;
      const pending = discoverGlobalLocation('npm', {
        fs: runtime.fs,
        environment: runtime.environment,
        execPath: runtime.execPath,
        paths: runtime.paths,
        scannedProjectPaths: runtime.scannedProjectPaths(),
        makeDirectory: (path: string) => runtime.makeDirectory(path),
        signal: abort.signal,
        spawn: runtime.probe,
      }).catch((error: unknown) => {
        settled = true;
        return error;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(b.launchProcess).toHaveBeenCalledTimes(2);
      const reason = new Error('TEST cancelled concurrent discovery');
      abort.abort(reason);
      for (const child of children) expect(child.stop).toHaveBeenCalledTimes(1);
      stops[0].resolve(termination);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      stops[1].resolve(termination);
      const error: unknown = await pending;
      if (termination === 'verified') {
        expect(error).toBe(reason);
        expect(await runtime.verifyProbeTermination!()).toBe(true);
        for (const child of children)
          expect(child.stop).toHaveBeenCalledTimes(1);
      } else {
        expect(error).toMatchObject({
          details: { reason: 'TERMINATION_UNCONFIRMED' },
        });
        children[0].stop.mockResolvedValueOnce('unconfirmed');
        expect(await runtime.verifyProbeTermination!()).toBe(false);
        for (const child of children)
          expect(child.stop).toHaveBeenCalledTimes(2);
        expect(await runtime.verifyProbeTermination!()).toBe(true);
        expect(children[0].stop).toHaveBeenCalledTimes(3);
        expect(children[1].stop).toHaveBeenCalledTimes(2);
      }
      expect(b.launchProcess).toHaveBeenCalledTimes(2);
    },
  );

  it('returns SERVICE_UNAVAILABLE on non-Windows activity starts without IO', async () => {
    const b = bindings();
    b.input.host = { platform: 'linux', execPath: '/usr/bin/node', env: {} };
    const runtime = createGlobalPackagesRuntime(b.input);
    const service = new GlobalPackagesService(runtime);
    await expect(
      service.inventory({ requestId: 'TEST' }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(b.launchProcess).not.toHaveBeenCalled();
    expect(b.f.tryEnter).not.toHaveBeenCalled();
  });
});
