import 'reflect-metadata';
import {
  buildYarnGlobalCommand,
  isYarnGlobalVersion,
  resolveYarnGlobalTool,
} from '@/global-packages/execution/yarn-global-command';
import {
  expectGlobalReason,
  memoryFs,
  TEST_PATHS as P,
} from '@/global-packages/__fixtures__/global-adapters';
import type { IGlobalResolvedLocation } from '@/global-packages/interfaces/global-packages.runtime';
import type { IYarnGlobalConfig } from '@/global-packages/interfaces/yarn-global.types';

const YARN_PATHS = {
  npmPrefix: 'D:\\TEST\\AppData\\npm',
  npmPkgDir: 'D:\\TEST\\AppData\\npm\\node_modules\\yarn',
  msiBinDir: 'C:\\Program Files (x86)\\Yarn\\bin',
  msiPkgDir: 'C:\\Program Files (x86)\\Yarn',
  prefixDir: 'D:\\TEST\\YarnPrefix',
  globalDir: 'D:\\TEST\\YarnData\\global',
  binDir: 'D:\\TEST\\YarnPrefix\\bin',
  cacheDir: 'D:\\TEST\\YarnCache',
  mutexFile: 'D:\\TEST\\data\\cache\\yarn-global.mutex',
  userYarnrc: 'D:\\TEST\\profile\\.yarnrc',
  globalYarnrc: 'D:\\TEST\\YarnPrefix\\etc\\yarnrc',
  userNpmrc: 'D:\\TEST\\profile\\.npmrc',
  globalNpmrc: 'D:\\TEST\\YarnPrefix\\etc\\npmrc',
} as const;

const yarnConfig = (
  patch: Partial<IYarnGlobalConfig> = {},
): IYarnGlobalConfig => ({
  prefixDir: YARN_PATHS.prefixDir,
  globalDir: YARN_PATHS.globalDir,
  globalRoot: `${YARN_PATHS.globalDir}\\node_modules`,
  binDir: YARN_PATHS.binDir,
  cacheDir: YARN_PATHS.cacheDir,
  mutexFile: YARN_PATHS.mutexFile,
  userYarnrc: YARN_PATHS.userYarnrc,
  globalYarnrc: YARN_PATHS.globalYarnrc,
  userNpmrc: YARN_PATHS.userNpmrc,
  globalNpmrc: YARN_PATHS.globalNpmrc,
  binOnPath: true,
  explicitPrefix: false,
  originalPath: [YARN_PATHS.binDir, 'C:\\Program Files\\nodejs'],
  selectors: { PREFIX: YARN_PATHS.prefixDir },
  configIdentities: [],
  missingConfigPaths: [],
  directoryIdentities: [],
  missingDirectoryPaths: [],
  policy: {
    defaultRegistry: 'public',
    scopedRegistries: [],
    unknownRouting: false,
    publicAuthPresent: false,
    changeUnsupported: false,
  },
  ...patch,
});

const yarnLocation = (
  version = '1.22.22',
  configPatch: Partial<IYarnGlobalConfig> = {},
): IGlobalResolvedLocation => {
  const cfg = yarnConfig(configPatch);
  return {
    manager: 'yarn',
    tool: {
      manager: 'yarn',
      version,
      file: P.node,
      entry: `${YARN_PATHS.npmPkgDir}\\bin\\yarn.js`,
      packageDir: YARN_PATHS.npmPkgDir,
      identities: [],
    },
    prefix: cfg.prefixDir,
    globalDir: cfg.globalDir,
    globalRoot: cfg.globalRoot,
    binDir: cfg.binDir,
    cacheDir: cfg.cacheDir,
    storeDir: null,
    userConfig: cfg.userYarnrc,
    globalConfig: cfg.globalYarnrc,
    configIdentities: [],
    yarn: cfg,
    cwd: P.cwd,
    protectedPaths: [YARN_PATHS.npmPkgDir, P.node, P.app, P.source, P.data],
  };
};

describe('Yarn Classic version gate', () => {
  it.each(['1.22.22', '1.0.0', '1.22.19'])('accepts Yarn 1.x %s', (v) => {
    expect(isYarnGlobalVersion(v)).toBe(true);
  });
  it.each(['2.0.0', '3.6.4', '4.5.1', '1.22.22-rc.1', 'v1.22.22', 'bad'])(
    'rejects Berry, prerelease or noncanonical %s',
    (v) => {
      expect(isYarnGlobalVersion(v)).toBe(false);
    },
  );
});

describe('resolveYarnGlobalTool', () => {
  const snapshot = (pathEnv: string, projectPaths: string[] = []) => ({
    platform: 'win32' as const,
    execPath: P.node,
    env: { PATH: pathEnv },
    projectPaths,
    signal: new AbortController().signal,
  });

  it('resolves npm-installed Yarn 1.22.22 from PATH without spawning', async () => {
    const { fs, put } = memoryFs();
    put(P.node, { text: 'EXE' });
    put(`${YARN_PATHS.npmPkgDir}\\package.json`, {
      text: JSON.stringify({
        name: 'yarn',
        version: '1.22.22',
        bin: { yarn: './bin/yarn.js', yarnpkg: './bin/yarn.js' },
      }),
    });
    put(`${YARN_PATHS.npmPkgDir}\\bin\\yarn.js`, { text: '// yarn' });
    const tool = await resolveYarnGlobalTool(
      snapshot(`C:\\Program Files\\nodejs;${YARN_PATHS.npmPrefix}`),
      fs,
    );
    expect(tool).toMatchObject({
      manager: 'yarn',
      version: '1.22.22',
      file: P.node,
      entry: `${YARN_PATHS.npmPkgDir}\\bin\\yarn.js`,
      packageDir: YARN_PATHS.npmPkgDir,
    });
    expect(tool.identities).toHaveLength(4);
  });

  it('resolves standalone Windows MSI layout (<parent>\\bin)', async () => {
    const { fs, put } = memoryFs();
    put(P.node, { text: 'EXE' });
    put(`${YARN_PATHS.msiPkgDir}\\package.json`, {
      text: JSON.stringify({
        name: 'yarn',
        version: '1.22.19',
        bin: { yarn: './bin/yarn.js' },
      }),
    });
    put(`${YARN_PATHS.msiPkgDir}\\bin\\yarn.js`, { text: '// msi yarn' });
    const tool = await resolveYarnGlobalTool(
      snapshot(YARN_PATHS.msiBinDir),
      fs,
    );
    expect(tool).toMatchObject({
      manager: 'yarn',
      version: '1.22.19',
      packageDir: YARN_PATHS.msiPkgDir,
      entry: `${YARN_PATHS.msiPkgDir}\\bin\\yarn.js`,
    });
  });

  it('refuses Yarn Berry 2+ with TOOL_VERSION_MISMATCH', async () => {
    const { fs, put } = memoryFs();
    put(P.node, { text: 'EXE' });
    put(`${YARN_PATHS.npmPkgDir}\\package.json`, {
      text: JSON.stringify({
        name: 'yarn',
        version: '4.5.0',
        bin: { yarn: './bin/yarn.js' },
      }),
    });
    put(`${YARN_PATHS.npmPkgDir}\\bin\\yarn.js`, { text: '// berry' });
    await expectGlobalReason(
      () => resolveYarnGlobalTool(snapshot(YARN_PATHS.npmPrefix), fs),
      'TOOL_VERSION_MISMATCH',
    );
  });

  it('refuses symlinked package directory or escaping bin path', async () => {
    const { fs, put } = memoryFs();
    put(P.node, { text: 'EXE' });
    put(`${YARN_PATHS.npmPkgDir}\\package.json`, {
      text: JSON.stringify({
        name: 'yarn',
        version: '1.22.22',
        bin: { yarn: '../../evil.js' },
      }),
    });
    await expectGlobalReason(
      () => resolveYarnGlobalTool(snapshot(YARN_PATHS.npmPrefix), fs),
      'TOOL_LAYOUT_UNSUPPORTED',
    );
  });

  it('returns TOOL_NOT_FOUND when Yarn is absent from PATH', async () => {
    const { fs, put } = memoryFs();
    put(P.node, { text: 'EXE' });
    await expectGlobalReason(
      () => resolveYarnGlobalTool(snapshot('C:\\Program Files\\nodejs'), fs),
      'TOOL_NOT_FOUND',
    );
  });
});

describe('buildYarnGlobalCommand', () => {
  it('places global <subcommand> first (E1) and pins folders + mutex for change', () => {
    const loc = yarnLocation();
    const cmd = buildYarnGlobalCommand(
      {
        location: loc,
        environment: {
          PATH: `${YARN_PATHS.binDir};D:\\TEST\\other`,
          YARN_CACHE_FOLDER: 'D:\\TEST\\evil-cache',
          YARN_REGISTRY: 'https://evil.invalid',
          YARN_YARN_PATH: 'D:\\TEST\\evil.js',
          NPM_TOKEN: 'secret',
          NODE_OPTIONS: '--require evil.js',
        },
        action: 'change',
        packageName: '@test/tool',
        exactVersion: '2.0.0',
        publicRegistry: true,
      },
      loc.yarn!,
    );
    expect(cmd.file).toBe(P.node);
    expect(cmd.args).toEqual([
      `${YARN_PATHS.npmPkgDir}\\bin\\yarn.js`,
      'global',
      'add',
      '--global-folder',
      YARN_PATHS.globalDir,
      '--prefix',
      YARN_PATHS.prefixDir,
      '--cache-folder',
      YARN_PATHS.cacheDir,
      '--mutex',
      `file:${YARN_PATHS.mutexFile}`,
      '--non-interactive',
      '--registry',
      'https://registry.npmjs.org',
      '--',
      '@test/tool@2.0.0',
    ]);
    expect(cmd.env.YARN_IGNORE_PATH).toBe('1');
    expect(cmd.env.YARN_ENABLE_TELEMETRY).toBe('0');
    expect(cmd.env.YARN_CACHE_FOLDER).toBe(YARN_PATHS.cacheDir);
    expect(cmd.env.PREFIX).toBe(YARN_PATHS.prefixDir);
    expect(cmd.env.CI).toBe('1');
    expect(cmd.env.YARN_REGISTRY).toBeUndefined();
    expect(cmd.env.NPM_TOKEN).toBeUndefined();
    expect(cmd.env.NODE_OPTIONS).toBeUndefined();
    expect(JSON.stringify(cmd)).not.toContain('secret');
  });

  it('pins remove without forced public registry so custom-registry removal works', () => {
    const loc = yarnLocation('1.22.22', {
      policy: {
        defaultRegistry: 'custom',
        scopedRegistries: ['@private'],
        unknownRouting: false,
        publicAuthPresent: false,
        changeUnsupported: true,
      },
    });
    const cmd = buildYarnGlobalCommand(
      {
        location: loc,
        environment: { PATH: YARN_PATHS.binDir },
        action: 'remove',
        packageName: 'semver',
        exactVersion: null,
        publicRegistry: false,
      },
      loc.yarn!,
    );
    expect(cmd.args.slice(1, 3)).toEqual(['global', 'remove']);
    expect(cmd.args).not.toContain('--registry');
    expect(cmd.args.slice(-2)).toEqual(['--', 'semver']);
  });

  it('refuses change when policy marks changeUnsupported', async () => {
    const loc = yarnLocation('1.22.22', {
      policy: {
        defaultRegistry: 'public',
        scopedRegistries: [],
        unknownRouting: false,
        publicAuthPresent: false,
        changeUnsupported: true,
      },
    });
    await expectGlobalReason(
      () =>
        buildYarnGlobalCommand(
          {
            location: loc,
            environment: { PATH: YARN_PATHS.binDir },
            action: 'change',
            packageName: 'semver',
            exactVersion: '7.7.2',
            publicRegistry: true,
          },
          loc.yarn!,
        ),
      'REGISTRY_CONFIG_UNSUPPORTED',
    );
  });
});
