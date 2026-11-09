import 'reflect-metadata';
import { buildRunnerEnvironment } from '@/npm-runner/toolchain/runner-environment';
import {
  fsFixture,
  key,
  root,
  tool,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import type {
  IRunnerCommand,
  RunAction,
} from '@/npm-runner/interfaces/npm-runner.types';
import { RUN_ACTIONS } from '@/npm-runner/interfaces/npm-runner.types';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type {
  IRunProcess,
  IRunProcessCallbacks,
  IRunProcessExit,
} from '@/npm-runner/execution/runner-process';

jest.mock('execa', () => ({ execa: jest.fn() }));

describe('runner child environment (A8)', () => {
  const appKeys = [
    'MODE',
    'HOST',
    'PORT',
    'GLOBAL_PREFIX',
    'VERSION',
    'LIST_ORIGIN_CORS',
    'EXPORT_SWAGGER_API_JSON',
    'SCAN_ROOT_PATHS',
    'MAX_SCAN_DEPTH',
    'SCAN_TIMEOUT_MS',
    'NPM_COMMAND_TIMEOUT_MS',
    'PKGSTEWARD_DATA_DIR',
  ];
  it('removes every validated BE key and inherited Node/PM launch state case-insensitively', () => {
    const denied = [
      ...appKeys,
      'NODE_ENV',
      'NODE_OPTIONS',
      'INIT_CWD',
      'PNPM_SCRIPT_SRC_DIR',
      'npm_config_registry',
      'NPM_TOKEN',
      'nPm_lifecycle_event',
    ];
    const snapshot = Object.fromEntries(
      denied.map((key) => [key.toLowerCase(), 'TEST-secret']),
    );
    const env = buildRunnerEnvironment(snapshot, tool(), 'npm', 'install_all');
    for (const key of denied)
      expect(Object.keys(env).map((name) => name.toLowerCase())).not.toContain(
        key.toLowerCase(),
      );
  });
  it('inherits OS, proxy, toolchain, SSH, app variables and arbitrary credentials per A8', () => {
    const snapshot = {
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      APPDATA: 'C:\\Users\\TEST\\AppData\\Roaming',
      HTTPS_PROXY: 'http://TEST-proxy',
      PYTHON: 'C:\\Python\\python.exe',
      SSH_AUTH_SOCK: 'TEST',
      MY_APP_TOKEN: 'TEST-secret',
      CUSTOM_SETTING: 'TEST',
    };
    expect(
      buildRunnerEnvironment(snapshot, tool(), 'npm', 'script'),
    ).toMatchObject(snapshot);
  });
  it('forces noninteractive color/Corepack guards and deduplicates casing', () => {
    const env = buildRunnerEnvironment(
      {
        no_color: '0',
        FORCE_COLOR: '3',
        Corepack_Enable_Network: '1',
        path: 'C:\\Windows',
        PATH: 'C:\\Other',
      },
      tool(),
      'pnpm',
      'script',
    );
    expect(env).toMatchObject({
      NoDefaultCurrentDirectoryInExePath: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      COREPACK_ENABLE_NETWORK: '0',
      COREPACK_ENABLE_AUTO_PIN: '0',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    });
    const keys = Object.keys(env).map((key) => key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('forces pnpm 11 config that has no CLI flag: no implicit install, no update check (RT1)', () => {
    const user = {
      PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'install',
      pnpm_config_update_notifier: 'true',
    };
    const pnpm = buildRunnerEnvironment(user, tool(), 'pnpm', 'script');
    expect(pnpm).toMatchObject({
      pnpm_config_verify_deps_before_run: 'false',
      pnpm_config_update_notifier: 'false',
    });
    const keys = Object.keys(pnpm).map((key) => key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    const npm = buildRunnerEnvironment({}, tool(), 'npm', 'script');
    expect(Object.keys(npm).some((key) => /^pnpm_config_/i.test(key))).toBe(
      false,
    );
  });
  it('keeps only absolute local PATH entries without expanding variables', () => {
    const env = buildRunnerEnvironment(
      {
        PATH: ';.;relative;C:relative;\\rooted;\\\\server\\share;%APPDATA%\\npm;C:\\Windows\\System32;D:\\Tools',
      },
      tool(),
      'npm',
      'script',
    );
    expect(env.PATH).toBe('C:\\Windows\\System32;D:\\Tools');
  });
  it.each([
    'install_all',
    'install_one',
    'update_all',
    'update_one',
    'uninstall_one',
  ] as RunAction[])('sets CI only for mutation %s', (action) => {
    expect(buildRunnerEnvironment({ CI: '0' }, tool(), 'npm', action).CI).toBe(
      '1',
    );
  });
  it('does not force or remove user CI for scripts', () => {
    expect(
      buildRunnerEnvironment({}, tool(), 'npm', 'script').CI,
    ).toBeUndefined();
    expect(
      buildRunnerEnvironment({ CI: 'custom' }, tool(), 'npm', 'script').CI,
    ).toBe('custom');
  });
  it('never mutates or aliases the frozen input snapshot', () => {
    const snapshot = Object.freeze({
      PORT: '24681',
      PATH: 'C:\\Windows',
      APP_SETTING: 'TEST',
    });
    const env = buildRunnerEnvironment(snapshot, tool(), 'npm', 'script');
    env.APP_SETTING = 'changed';
    expect(snapshot).toEqual({
      PORT: '24681',
      PATH: 'C:\\Windows',
      APP_SETTING: 'TEST',
    });
  });
  it.each(RUN_ACTIONS)(
    'keeps npm 11/12 environments identical without script/config overrides: %s',
    (action) => {
      const snapshot = Object.freeze({
        Path: '.;C:\\Windows\\System32;relative;%APPDATA%\\npm',
        nPm_CoNfIg_AlLoW_ScRiPtS: 'true',
        NPM_CONFIG_IGNORE_SCRIPTS: 'false',
        npm_config_strict_npmrc: 'false',
        npm_config_force: 'true',
        NpM_ToKeN: 'TEST-secret',
        NoDe_OpTiOnS: '--require TEST',
        sCaN_rOoT_pAtHs: 'TEST-private-path',
        COREPACK_ENABLE_NETWORK: '1',
        CI: 'TEST-custom',
        TEST_APP: 'TEST-inherited',
      });
      const env = buildRunnerEnvironment(
        snapshot,
        tool('npm', '12.2.2'),
        'npm',
        action,
      );
      expect(env).toEqual(
        buildRunnerEnvironment(snapshot, tool('npm', '11.17.0'), 'npm', action),
      );
      expect(env).toMatchObject({
        PATH: 'C:\\Windows\\System32',
        COREPACK_ENABLE_NETWORK: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        CI: action === 'script' ? 'TEST-custom' : '1',
        TEST_APP: 'TEST-inherited',
      });
      expect(
        Object.keys(env).some((name) =>
          /^(?:npm_|pnpm_config_|node_options$|scan_root_paths$)/i.test(name),
        ),
      ).toBe(false);
      expect(
        buildRunnerEnvironment({}, tool('npm', '12.2.2'), 'npm', action).CI,
      ).toBe(action === 'script' ? undefined : '1');
    },
  );
});

// TEST strict-config failure; không phải yêu cầu nghiệp vụ.
describe('npm 12 config failure remains a normal failed runner job', () => {
  it('fails once without repairing or retrying strict npmrc', async () => {
    const f = fsFixture();
    const installed = f.installTool('npm', '12.2.2');
    installed.identities = installed.identities.map((identity) => ({
      path: identity.path,
      stat: f.stats.get(key(identity.path))!,
    }));
    f.resolveTool.mockResolvedValue(installed);
    const config = `${root}\\.npmrc`;
    const text = 'strict-npmrc=true\nTEST-unknown-config=true\n';
    f.put(config, text);
    const outcome: IRunProcessExit = {
      exitCode: 1,
      signal: null,
      failureCode: 'COMMAND_FAILED',
      termination: 'verified',
      outputTruncated: false,
    };
    const runtime = {
      input: f.deps,
      env: {},
      // The service refuses to start without the Windows process adapter.
      processes: {
        capture: jest.fn(() => Promise.resolve({ status: 'unknown' as const })),
        descendants: jest.fn(() =>
          Promise.resolve({ status: 'unknown' as const }),
        ),
        stopTree: jest.fn(() => Promise.resolve('attempted' as const)),
        verifyGone: jest.fn(() => Promise.resolve('verified' as const)),
      },
      timeoutMs: undefined,
      gate: new MutationGateService(),
      readers: {
        hasRunningScan: () => false,
        hasRunningMeasurement: () => false,
        hasRunningPreview: () => false,
        hasRunningAnalysis: () => false,
      },
      audit: {
        writeIntent: jest.fn(() => Promise.resolve()),
        writeResult: jest.fn(() => Promise.resolve()),
      },
      invalidation: {
        refreshProject: jest.fn(() => Promise.resolve()),
        clearDiskUsage: jest.fn(),
        staleAnalysis: jest.fn(),
      },
      launch: jest.fn(
        (
          _command: IRunnerCommand,
          _env: NodeJS.ProcessEnv,
          callbacks: IRunProcessCallbacks,
        ): IRunProcess => {
          callbacks.onOutput('stderr', Buffer.from('TEST strict-npmrc error'));
          return {
            pid: 123,
            settled: Promise.resolve(outcome),
            stop: jest.fn(() => Promise.resolve('verified' as const)),
          };
        },
      ),
      now: () => new Date('2026-11-10T00:00:00Z'),
      uuid: () => '00000000-0000-4000-8000-000000000010',
      setTimer: (callback: () => void, milliseconds: number) =>
        setTimeout(callback, milliseconds),
      clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    } satisfies INpmRunnerRuntime;
    const service = new NpmRunnerService(runtime);
    const context = await service.context(root);
    expect(context.available).toBe(true);
    await service.start({
      path: root,
      inputHash: context.inputHash,
      requestId: '00000000-0000-4000-8000-000000000020',
      action: 'install_all',
    });
    for (let turn = 0; turn < 1000; turn++) {
      if (service.latest()?.phase === 'done') break;
      await Promise.resolve();
    }
    expect(service.latest()).toMatchObject({
      phase: 'done',
      status: 'failed',
      version: '12.2.2',
      exitCode: 1,
      failureCode: 'COMMAND_FAILED',
      gateHeld: false,
    });
    expect(runtime.launch).toHaveBeenCalledTimes(1);
    expect(f.files.get(key(config))?.toString()).toBe(text);
  });
});
