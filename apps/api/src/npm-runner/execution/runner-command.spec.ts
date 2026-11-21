import {
  buildRunCommand,
  parseRunnerPackageSpec,
  pnpmPrefixArgs,
} from '@/npm-runner/execution/runner-command';
import {
  runnerInput,
  tool,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import type {
  IRunRequest,
  IRunnerNpm10InstallCompat,
  RunAction,
} from '@/npm-runner/interfaces/npm-runner.types';

const request = (
  action: RunAction,
  extra: Partial<IRunRequest> = {},
): IRunRequest => ({
  path: 'D:\\TEST\\project',
  inputHash: 'a'.repeat(64),
  requestId: '00000000-0000-4000-8000-000000000001',
  action,
  ...extra,
});
const rows: [RunAction, Partial<IRunRequest>, string[], string[]][] = [
  [
    'install_all',
    {},
    ['install'],
    ['install', '--no-frozen-lockfile', '--reporter=append-only'],
  ],
  [
    'install_one',
    { package: '@scope/alpha@1.2.3' },
    ['install', '--save-prod', '--', '@scope/alpha@1.2.3'],
    [
      'add',
      '--global=false',
      '--save-prod',
      '--reporter=append-only',
      '--',
      '@scope/alpha@1.2.3',
    ],
  ],
  [
    'update_all',
    {},
    ['update'],
    ['update', '--global=false', '--reporter=append-only'],
  ],
  [
    'update_one',
    { package: 'alpha' },
    ['update', '--', 'alpha'],
    ['update', '--global=false', '--reporter=append-only', '--', 'alpha'],
  ],
  [
    'uninstall_one',
    { package: 'alpha' },
    ['uninstall', '--', 'alpha'],
    ['remove', '--reporter=append-only', '--', 'alpha'],
  ],
  ['script', { script: 'dev' }, ['run-script', '--', 'dev'], ['run', 'dev']],
];

describe('runner command grammar and fixed argv', () => {
  describe.each([
    ['npm', '10.9.9'],
    ['npm', '11.17.0'],
    ['npm', '12.2.2'],
    ['pnpm', '10.34.9'],
    ['pnpm', '11.22.0'],
  ] as const)('%s %s', (manager, version) => {
    it.each(rows)(
      '%s pins every argument and the absolute Node entry',
      (action, extra, npm, pnpm) => {
        const context = runnerInput(manager);
        context.tool = tool(manager, version);
        context.path = 'D:\\TEST tiếng Việt\\project with spaces';
        context.tool.entry = 'C:\\TEST công cụ\\bin\\cli.js';
        const compat: IRunnerNpm10InstallCompat = {
          revision: 1,
          supported: true,
          preload: 'C:\\TEST ứng dụng\\npm10-install-preload.js',
          source: 'C:\\TEST SDK\\lib\\commands\\install.js',
          loader: 'C:\\TEST SDK\\lib\\npm.js',
          sourceSha256: 'a'.repeat(64),
          loaderSha256: 'b'.repeat(64),
          preloadSha256: 'c'.repeat(64),
        };
        context.tool.npm10InstallCompat = compat;
        const prefix =
          manager === 'npm'
            ? [
                '--prefix',
                context.path,
                '--global=false',
                '--no-audit',
                '--no-fund',
                '--no-progress',
                '--update-notifier=false',
              ]
            : // pnpm 11.22 (RT1): only add/update accept --global; the
              // version-switch setting is pm-on-fail (default "download").
              // update-notifier / verify-deps-before-run go through the env.
              // pnpm 10.34.9 rejects --pm-on-fail; its switch is this config key.
              [
                '--dir',
                context.path,
                version.startsWith('10.')
                  ? '--config.manage-package-manager-versions=false'
                  : '--pm-on-fail=warn',
              ];
        expect(buildRunCommand(context, request(action, extra))).toEqual({
          file: context.tool?.file,
          args: [
            ...(manager === 'npm' &&
            version === '10.9.9' &&
            action === 'install_all'
              ? ['--require', compat.preload]
              : []),
            context.tool?.entry,
            ...prefix,
            ...(manager === 'npm' ? npm : pnpm),
          ],
          cwd: context.path,
          manager,
          version: context.tool?.version,
        });
      },
    );
    it.each(['install', 'env', 'add'])(
      'treats script collision %s as data',
      (script) => {
        const context = runnerInput(manager);
        context.tool = tool(manager, version);
        context.scripts[script] = 'echo TEST';
        const command = buildRunCommand(context, request('script', { script }));
        expect(command.args.slice(manager === 'npm' ? -3 : -2)).toEqual(
          manager === 'npm' ? ['run-script', '--', script] : ['run', script],
        );
      },
    );
  });
  it.each([
    undefined,
    { revision: 1, supported: false, fingerprint: 'TEST' },
  ] as const)(
    'refuses only npm10 install_all without supported compatibility: %p',
    (compat) => {
      const context = runnerInput();
      context.tool = { ...tool('npm', '10.9.9'), npm10InstallCompat: compat };
      let failure: unknown;
      try {
        buildRunCommand(context, request('install_all'));
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
      });
      for (const [action, extra] of rows.filter(
        ([action]) => action !== 'install_all',
      ))
        expect(buildRunCommand(context, request(action, extra)).args[0]).toBe(
          context.tool.entry,
        );
    },
  );
  it.each([9, 13, 0, NaN])('gives pnpm major %p no arguments', (major) => {
    expect(pnpmPrefixArgs(major, 'D:\\TEST\\project')).toBeNull();
  });
  it('uses --pm-on-fail=warn for pnpm 12 prefix arguments', () => {
    expect(pnpmPrefixArgs(12, 'D:\\TEST\\project')).toEqual([
      '--dir',
      'D:\\TEST\\project',
      '--pm-on-fail=warn',
    ]);
  });
  describe('pnpm 12.21.0 native executable', () => {
    it.each(rows)(
      '%s launches pnpm.exe directly without prepending a script entry',
      (action, extra, _npm, pnpm) => {
        const context = runnerInput('pnpm');
        context.tool = tool('pnpm', '12.21.0');
        context.path = 'D:\\TEST tiếng Việt\\project with spaces';
        expect(buildRunCommand(context, request(action, extra))).toEqual({
          file: context.tool.file,
          args: ['--dir', context.path, '--pm-on-fail=warn', ...pnpm],
          cwd: context.path,
          manager: 'pnpm',
          version: '12.21.0',
        });
      },
    );
    it.each(['install', 'env', 'add'])(
      'treats script collision %s as data',
      (script) => {
        const context = runnerInput('pnpm');
        context.tool = tool('pnpm', '12.21.0');
        context.scripts[script] = 'echo TEST';
        const command = buildRunCommand(context, request('script', { script }));
        expect(command.args.slice(-2)).toEqual(['run', script]);
      },
    );
    it.each([
      {
        label: 'non-null entry',
        override: { entry: 'C:\\TEST\\node_modules\\pnpm\\bin\\pnpm.mjs' },
      },
      {
        label: 'non-exe file',
        override: {
          file: 'C:\\TEST\\node_modules\\pnpm\\pnpm.cmd',
          entry: null,
        },
      },
      {
        label: 'extensionless file',
        override: { file: 'C:\\TEST\\node_modules\\pnpm\\pnpm', entry: null },
      },
    ])('refuses forged pnpm 12 launcher ($label)', ({ override }) => {
      const context = runnerInput('pnpm');
      context.tool = { ...tool('pnpm', '12.21.0'), ...override };
      expect.assertions(rows.length);
      for (const [action, extra] of rows) {
        try {
          buildRunCommand(context, request(action, extra));
        } catch (error: unknown) {
          expect(error).toMatchObject({
            details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
          });
        }
      }
    });
    it('keeps pnpm 12 workspace mutation and script boundaries', () => {
      expect.assertions(rows.length * 2);
      const context = runnerInput('pnpm');
      context.tool = tool('pnpm', '12.21.0');
      context.workspace = { kind: 'root', root: context.path };
      for (const [action, extra] of rows)
        expect(buildRunCommand(context, request(action, extra)).cwd).toBe(
          context.path,
        );
      context.workspace = { kind: 'leaf', root: 'D:\\TEST' };
      expect(
        buildRunCommand(context, request('script', { script: 'dev' })).cwd,
      ).toBe(context.path);
      for (const [action, extra] of rows) {
        if (action === 'script') continue;
        try {
          buildRunCommand(context, request(action, extra));
        } catch (error: unknown) {
          expect(error).toMatchObject({
            details: { reason: 'WORKSPACE_LEAF' },
          });
        }
      }
    });
  });
  const packageRows: [string, string, string | null][] = [
    ['alpha', 'alpha', null],
    ['@scope/alpha', '@scope/alpha', null],
    ['@scope/alpha@1.2.3', '@scope/alpha', '1.2.3'],
    ['alpha@1.2.3-rc.1+build.2', 'alpha', '1.2.3-rc.1+build.2'],
    ['alpha@next-1', 'alpha', 'next-1'],
    ['alpha@latest', 'alpha', 'latest'],
  ];
  it.each(packageRows)(
    'parses %s without splitting a scope at its first @',
    (value, name, version) => {
      expect(parseRunnerPackageSpec(value, true)).toEqual({
        name,
        version,
        spec: value,
      });
    },
  );
  const rejected = [
    '-g',
    '--prefix=x',
    '.alpha',
    'Alpha',
    'álpha',
    'a..b',
    '@scope',
    '@scope/-pkg',
    '@.scope/pkg',
    'alpha beta',
    'alpha\t',
    'alpha\n',
    'alpha\r',
    'alpha\0',
    'alpha\\x',
    'alpha@^1',
    'alpha@~1',
    'alpha@>=1',
    'alpha@*',
    'alpha@1 || 2',
    'alpha@1.2',
    'alpha@01.2.3',
    'alpha@file:../x',
    'alpha@link:x',
    'alpha@workspace:*',
    'alpha@npm:beta',
    'git+https://x',
    'https://x/a.tgz',
    './alpha',
    '/alpha',
    'C:\\alpha',
    '\\\\host\\alpha',
    'a@b@c',
    ...['"', "'", '`', '%', '!', '^', '&', '|', '<', '>', '(', ')', ';'].map(
      (char) => `alpha${char}`,
    ),
    'x'.repeat(215),
    `alpha@${'x'.repeat(65)}`,
    `alpha@1.2.3+${'x'.repeat(128)}`,
  ];
  it.each(rejected)('rejects %p before any launch callback', (value) => {
    const spawn = jest.fn((command: unknown) => {
      void command;
    });
    expect(() =>
      spawn(
        buildRunCommand(
          runnerInput(),
          request('install_one', { package: value }),
        ),
      ),
    ).toThrow();
    expect(spawn).not.toHaveBeenCalled();
    expect(() => parseRunnerPackageSpec(value, true)).toThrow();
  });
  it('accepts name/tag length boundaries', () => {
    expect(parseRunnerPackageSpec('x'.repeat(214), true).name).toHaveLength(
      214,
    );
    expect(
      parseRunnerPackageSpec(`alpha@${'x'.repeat(64)}`, true).version,
    ).toHaveLength(64);
  });
  it('accepts supported script characters and the 128-character boundary', () => {
    const context = runnerInput();
    for (const script of ['build:TEST_1-a', 'x'.repeat(128)]) {
      context.scripts[script] = 'echo TEST';
      expect(
        buildRunCommand(context, request('script', { script })).args.at(-1),
      ).toBe(script);
    }
  });
  it.each(['update_one', 'uninstall_one'] as const)(
    '%s requires a current direct declaration and name only',
    (action) => {
      for (const value of ['missing', 'alpha@1.2.3', 'alpha@latest']) {
        expect(() =>
          buildRunCommand(runnerInput(), request(action, { package: value })),
        ).toThrow();
      }
      const context = runnerInput();
      context.manifest.dependencies = [
        {
          name: 'alpha',
          declarations: [{ group: 'peerDependencies', spec: '^1.0.0' }],
        },
      ];
      expect(
        buildRunCommand(context, request(action, { package: 'alpha' })).args,
      ).toContain('alpha');
    },
  );
  it.each([
    '--dev',
    'a b',
    'a;echo',
    'a\n',
    'x'.repeat(129),
    'missing',
    'toString',
  ])('rejects undeclared/unsupported script %p', (script) => {
    expect(() =>
      buildRunCommand(runnerInput(), request('script', { script })),
    ).toThrow();
  });
  it('rejects an inherited script and empty/non-string own declarations', () => {
    const context = runnerInput();
    context.scripts = Object.create({ dev: 'echo TEST' }) as Record<
      string,
      unknown
    >;
    expect(() =>
      buildRunCommand(context, request('script', { script: 'dev' })),
    ).toThrow();
    for (const value of ['', 1, null]) {
      context.scripts = { dev: value };
      expect(() =>
        buildRunCommand(context, request('script', { script: 'dev' })),
      ).toThrow();
    }
  });
  it.each([
    'install_all',
    'install_one',
    'update_all',
    'update_one',
    'uninstall_one',
  ] as const)('refuses leaf mutation %s', (action) => {
    expect.assertions(1);
    const context = runnerInput();
    context.workspace = { kind: 'leaf', root: 'D:\\TEST' };
    try {
      buildRunCommand(context, request(action, { package: 'alpha' }));
    } catch (error: unknown) {
      expect(error).toMatchObject({ details: { reason: 'WORKSPACE_LEAF' } });
    }
  });
  it('allows leaf scripts and all actions at workspace root', () => {
    const context = runnerInput();
    context.workspace = { kind: 'leaf', root: 'D:\\TEST' };
    expect(
      buildRunCommand(context, request('script', { script: 'dev' })).cwd,
    ).toBe(context.path);
    context.workspace = { kind: 'root', root: context.path };
    for (const [action, extra] of rows)
      expect(buildRunCommand(context, request(action, extra)).cwd).toBe(
        context.path,
      );
  });
  it('never substitutes npm for unknown, ambiguous or Yarn', () => {
    for (const manager of ['unknown', 'ambiguous', 'yarn'] as const) {
      const context = runnerInput();
      context.manager = manager;
      expect(() => buildRunCommand(context, request('install_all'))).toThrow();
    }
  });
  it('refuses an unavailable tool and an unsupported installed major', () => {
    const context = runnerInput();
    context.tool = null;
    expect(() => buildRunCommand(context, request('install_all'))).toThrow();
    context.tool = { ...tool(), version: '9.9.4' };
    expect(() => buildRunCommand(context, request('install_all'))).toThrow();
  });
  it.each([
    ['npm', '13.0.0'],
    ['npm', '12.2.2-rc.1'],
    ['npm', 'invalid'],
    ['pnpm', '13.0.0'],
    ['pnpm', '12.21.0-rc.1'],
  ] as const)('refuses a forged %s %s context', (manager, version) => {
    const context = runnerInput(manager);
    context.tool = tool(manager, version);
    expect.assertions(rows.length);
    for (const [action, extra] of rows) {
      try {
        buildRunCommand(context, request(action, extra));
      } catch (error: unknown) {
        expect(error).toMatchObject({
          details: { reason: 'TOOL_VERSION_MISMATCH' },
        });
      }
    }
  });
  it('keeps npm 12 workspace mutation and script boundaries', () => {
    expect.assertions(rows.length * 2);
    const context = runnerInput();
    context.tool = tool('npm', '12.2.2');
    context.workspace = { kind: 'root', root: context.path };
    for (const [action, extra] of rows)
      expect(buildRunCommand(context, request(action, extra)).cwd).toBe(
        context.path,
      );
    context.workspace = { kind: 'leaf', root: 'D:\\TEST' };
    expect(
      buildRunCommand(context, request('script', { script: 'dev' })).cwd,
    ).toBe(context.path);
    for (const [action, extra] of rows) {
      if (action === 'script') continue;
      try {
        buildRunCommand(context, request(action, extra));
      } catch (error: unknown) {
        expect(error).toMatchObject({ details: { reason: 'WORKSPACE_LEAF' } });
      }
    }
  });
  it('refuses a different manager distribution rather than changing the requested adapter', () => {
    const context = runnerInput('pnpm');
    context.tool = tool('npm');
    expect(() => buildRunCommand(context, request('install_all'))).toThrow();
  });
});
