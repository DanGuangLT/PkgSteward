import 'reflect-metadata';
import {
  buildInteractiveShellEnv,
  buildRunnerEnvironment,
} from '@/npm-runner/toolchain/runner-environment';
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
import type * as MutationGate from '@/core/mutation-gate/mutation-gate.service';
import type * as RunnerService from '@/npm-runner/npm-runner.service';
import type { INpmRunnerRuntime } from '@/npm-runner/interfaces/npm-runner.runtime';
import type { IRunJob } from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunProcess,
  IRunProcessCallbacks,
  IRunProcessExit,
} from '@/npm-runner/execution/runner-process';

jest.mock('execa', () => ({ execa: jest.fn() }));

describe('interactive shell environment', () => {
  it('keeps validated user OS state but removes automation and private launch state', () => {
    const snapshot = Object.freeze({
      Path: '.;C:\\Windows\\System32;%APPDATA%\\npm;D:\\Tools',
      USERPROFILE: 'C:\\Users\\TEST',
      APPDATA: 'C:\\Users\\TEST\\AppData',
      LOCALAPPDATA: 'C:\\Users\\TEST\\Local',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
      SystemRoot: 'C:\\Windows',
      MY_TOKEN: 'TEST',
      CI: 'true',
      no_color: '1',
      FORCE_COLOR: '0',
      PORT: '24681',
      NODE_OPTIONS: '--inspect',
      node_channel_extra: '5',
      PKGSTEWARD_PRIVATE: 'TEST',
      npm_token: 'TEST',
    });
    const env = buildInteractiveShellEnv(snapshot);
    expect(env).toEqual({
      PATH: 'C:\\Windows\\System32;D:\\Tools',
      USERPROFILE: 'C:\\Users\\TEST',
      APPDATA: 'C:\\Users\\TEST\\AppData',
      LOCALAPPDATA: 'C:\\Users\\TEST\\Local',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
      SystemRoot: 'C:\\Windows',
      MY_TOKEN: 'TEST',
    });
    expect(snapshot.CI).toBe('true');
  });
  it('drops invalid user directory values and duplicate casing without mutating input', () => {
    expect(
      buildInteractiveShellEnv({
        USERPROFILE: 'relative',
        TEMP: 'C:\\Temp\nBAD',
        APPDATA: '%USERPROFILE%\\AppData',
        SystemRoot: 'C:\\Windows',
        PATH: 'C:\\Windows',
        path: 'D:\\Other',
      }),
    ).toEqual({ SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows' });
  });
});

describe('runner child environment (A8)', () => {
  describe.each([
    ['npm', '10.9.9'],
    ['npm', '11.17.0'],
    ['npm', '12.2.2'],
    ['pnpm', '10.34.9'],
    ['pnpm', '11.22.0'],
  ] as const)('compat environment %s %s', (manager, version) => {
    it.each(RUN_ACTIONS)(
      'strips inherited private keys and sets exact schema only for install_all: %s',
      (action) => {
        const selected = tool(manager, version);
        selected.npm10InstallCompat = {
          revision: 1,
          supported: true,
          preload: 'C:\\TEST ứng dụng\\preload.js',
          source: 'C:\\TEST SDK\\lib\\commands\\install.js',
          loader: 'C:\\TEST SDK\\lib\\npm.js',
          sourceSha256: 'a'.repeat(64),
          loaderSha256: 'b'.repeat(64),
          preloadSha256: 'c'.repeat(64),
        };
        const snapshot = Object.freeze({
          PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT: 'TEST forged',
          pkgsteward_runner_npm10_install_compat: 'TEST forged lower',
          PkGsTeWaRd_RuNnEr_NpM10_Install_Compat_EXTRA: 'TEST private',
          NODE_PATH: 'C:\\TEST dependencies',
          TEST_APP: 'TEST inherited',
        });
        const env = buildRunnerEnvironment(snapshot, selected, manager, action);
        const privateKeys = Object.keys(env).filter((key) =>
          key
            .toUpperCase()
            .startsWith('PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT'),
        );
        if (
          manager === 'npm' &&
          version === '10.9.9' &&
          action === 'install_all'
        ) {
          expect(privateKeys).toEqual([
            'PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT',
          ]);
          expect(
            JSON.parse(env.PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT!),
          ).toEqual({
            schema: 1,
            entry: selected.entry,
            version,
            sourceSha256: 'a'.repeat(64),
            loaderSha256: 'b'.repeat(64),
            preloadSha256: 'c'.repeat(64),
          });
        } else expect(privateKeys).toEqual([]);
        expect(env.NODE_PATH).toBe('C:\\TEST dependencies');
        expect(env.TEST_APP).toBe('TEST inherited');
      },
    );
  });
  it('does not emit a private descriptor for unsupported npm10 compatibility', () => {
    const selected = tool('npm', '10.9.9');
    selected.npm10InstallCompat = {
      revision: 1,
      supported: false,
      fingerprint: 'TEST',
    };
    expect(
      buildRunnerEnvironment(
        { PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT: 'TEST' },
        selected,
        'npm',
        'install_all',
      ).PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT,
    ).toBeUndefined();
  });
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
  it('forces pnpm 10 config through npm_config_ env, which a standalone project reads (pnpm 10.34.9)', () => {
    // pnpm 10.34.9 applies pnpm_config_verify_deps_before_run only inside a workspace;
    // its env config layer is npm_config_*, above the project .npmrc.
    const user = {
      npm_config_verify_deps_before_run: 'install',
      NPM_CONFIG_UPDATE_NOTIFIER: 'true',
    };
    const pnpm10 = buildRunnerEnvironment(
      user,
      tool('pnpm', '10.34.9'),
      'pnpm',
      'script',
    );
    expect(pnpm10).toMatchObject({
      npm_config_verify_deps_before_run: 'false',
      npm_config_update_notifier: 'false',
      pnpm_config_verify_deps_before_run: 'false',
      pnpm_config_update_notifier: 'false',
    });
    const keys = Object.keys(pnpm10).map((key) => key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    const pnpm11 = buildRunnerEnvironment(
      user,
      tool('pnpm', '11.22.0'),
      'pnpm',
      'script',
    );
    expect(Object.keys(pnpm11).some((key) => /^npm_/i.test(key))).toBe(false);
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
    const { MutationGateService } = jest.requireActual<typeof MutationGate>(
      '@/core/mutation-gate/mutation-gate.service',
    );
    const { NpmRunnerService } = jest.requireActual<typeof RunnerService>(
      '@/npm-runner/npm-runner.service',
    );
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
      if ((service.latest() as IRunJob)?.phase === 'done') break;
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
