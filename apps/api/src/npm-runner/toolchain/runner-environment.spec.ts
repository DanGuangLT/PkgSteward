import 'reflect-metadata';
import { buildRunnerEnvironment } from '@/npm-runner/toolchain/runner-environment';
import { tool } from '@/npm-runner/__fixtures__/runner-test.fixture';
import type { RunAction } from '@/npm-runner/interfaces/npm-runner.types';

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
});
