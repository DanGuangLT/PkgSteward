import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, win32 as path } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// TEST fixture: npm@10.9.9 lib/commands/install.js, unmodified CRLF bytes.
// SHA256: 338a549e0f597045b834ea7f110311e772c4e437f2e6ea739ef2b5435f77dc64
// Copyright (c) npm, Inc. and Contributors; The Artistic License 2.0.
// Source: https://github.com/npm/cli/blob/v10.9.9/lib/commands/install.js
// License: https://github.com/npm/cli/blob/v10.9.9/LICENSE
// sdkLoader below is the static cmd excerpt from the same SDK's lib/npm.js.
// All SDK effects run through mocks.

const sdkSource = [
  'const { readdir } = require(\u0027node:fs/promises\u0027)',
  'const { resolve, join } = require(\u0027node:path\u0027)',
  'const { log } = require(\u0027proc-log\u0027)',
  'const runScript = require(\u0027@npmcli/run-script\u0027)',
  'const pacote = require(\u0027pacote\u0027)',
  'const checks = require(\u0027npm-install-checks\u0027)',
  'const reifyFinish = require(\u0027../utils/reify-finish.js\u0027)',
  'const ArboristWorkspaceCmd = require(\u0027../arborist-cmd.js\u0027)',
  '',
  'class Install extends ArboristWorkspaceCmd {',
  '  static description = \u0027Install a package\u0027',
  '  static name = \u0027install\u0027',
  '',
  '  // These are in the order they will show up in when running "-h"',
  '  // If adding to this list, consider adding also to ci.js',
  '  static params = [',
  '    \u0027save\u0027,',
  '    \u0027save-exact\u0027,',
  '    \u0027global\u0027,',
  '    \u0027install-strategy\u0027,',
  '    \u0027legacy-bundling\u0027,',
  '    \u0027global-style\u0027,',
  '    \u0027omit\u0027,',
  '    \u0027include\u0027,',
  '    \u0027strict-peer-deps\u0027,',
  '    \u0027prefer-dedupe\u0027,',
  '    \u0027package-lock\u0027,',
  '    \u0027package-lock-only\u0027,',
  '    \u0027foreground-scripts\u0027,',
  '    \u0027ignore-scripts\u0027,',
  '    \u0027audit\u0027,',
  '    \u0027bin-links\u0027,',
  '    \u0027fund\u0027,',
  '    \u0027dry-run\u0027,',
  '    \u0027cpu\u0027,',
  '    \u0027os\u0027,',
  '    \u0027libc\u0027,',
  '    ...super.params,',
  '  ]',
  '',
  '  static usage = [\u0027[\u003cpackage-spec\u003e ...]\u0027]',
  '',
  '  static async completion (opts) {',
  '    const { partialWord } = opts',
  '    // install can complete to a folder with a package.json, or any package.',
  '    // if it has a slash, then it\u0027s gotta be a folder',
  '    // if it starts with https?://, then just give up, because it\u0027s a url',
  '    if (/^https?:\\/\\//.test(partialWord)) {',
  '      // do not complete to URLs',
  '      return []',
  '    }',
  '',
  '    if (/\\//.test(partialWord)) {',
  '      // Complete fully to folder if there is exactly one match and it',
  '      // is a folder containing a package.json file.  If that is not the',
  '      // case we return 0 matches, which will trigger the default bash',
  '      // complete.',
  '      const lastSlashIdx = partialWord.lastIndexOf(\u0027/\u0027)',
  '      const partialName = partialWord.slice(lastSlashIdx + 1)',
  '      const partialPath = partialWord.slice(0, lastSlashIdx) || \u0027/\u0027',
  '',
  '      const isDirMatch = async sibling =\u003e {',
  '        if (sibling.slice(0, partialName.length) !== partialName) {',
  '          return false',
  '        }',
  '',
  '        try {',
  '          const contents = await readdir(join(partialPath, sibling))',
  '          const result = (contents.indexOf(\u0027package.json\u0027) !== -1)',
  '          return result',
  '        } catch (er) {',
  '          return false',
  '        }',
  '      }',
  '',
  '      try {',
  '        const siblings = await readdir(partialPath)',
  '        const matches = []',
  '        for (const sibling of siblings) {',
  '          if (await isDirMatch(sibling)) {',
  '            matches.push(sibling)',
  '          }',
  '        }',
  '        if (matches.length === 1) {',
  '          return [join(partialPath, matches[0])]',
  '        }',
  '        // no matches',
  '        return []',
  '      } catch (er) {',
  '        return [] // invalid dir: no matching',
  '      }',
  '    }',
  '    // Note: there used to be registry completion here,',
  '    // but it stopped making sense somewhere around',
  '    // 50,000 packages on the registry',
  '  }',
  '',
  '  async exec (args) {',
  '    // the /path/to/node_modules/..',
  '    const globalTop = resolve(this.npm.globalDir, \u0027..\u0027)',
  '    const ignoreScripts = this.npm.config.get(\u0027ignore-scripts\u0027)',
  '    const isGlobalInstall = this.npm.global',
  '    const where = isGlobalInstall ? globalTop : this.npm.prefix',
  '    const forced = this.npm.config.get(\u0027force\u0027)',
  '    const scriptShell = this.npm.config.get(\u0027script-shell\u0027) || undefined',
  '',
  '    // be very strict about engines when trying to update npm itself',
  '    const npmInstall = args.find(arg =\u003e arg.startsWith(\u0027npm@\u0027) || arg === \u0027npm\u0027)',
  '    if (isGlobalInstall \u0026\u0026 npmInstall) {',
  '      const npmOptions = this.npm.flatOptions',
  '      const npmManifest = await pacote.manifest(npmInstall, npmOptions)',
  '      try {',
  '        checks.checkEngine(npmManifest, npmManifest.version, process.version)',
  '      } catch (e) {',
  '        if (forced) {',
  '          log.warn(',
  '            \u0027install\u0027,',
  '            /* eslint-disable-next-line max-len */',
  '            `Forcing global npm install with incompatible version ${npmManifest.version} into node ${process.version}`',
  '          )',
  '        } else {',
  '          throw e',
  '        }',
  '      }',
  '    }',
  '',
  '    // don\u0027t try to install the prefix into itself',
  '    args = args.filter(a =\u003e resolve(a) !== this.npm.prefix)',
  '',
  '    // `npm i -g` =\u003e "install this package globally"',
  '    if (where === globalTop \u0026\u0026 !args.length) {',
  '      args = [\u0027.\u0027]',
  '    }',
  '',
  '    // throw usage error if trying to install empty package',
  '    // name to global space, e.g: `npm i -g ""`',
  '    if (where === globalTop \u0026\u0026 !args.every(Boolean)) {',
  '      throw this.usageError()',
  '    }',
  '',
  '    const Arborist = require(\u0027@npmcli/arborist\u0027)',
  '    const opts = {',
  '      ...this.npm.flatOptions,',
  '      auditLevel: null,',
  '      path: where,',
  '      add: args,',
  '      workspaces: this.workspaceNames,',
  '    }',
  '    const arb = new Arborist(opts)',
  '    await arb.reify(opts)',
  '',
  '    if (!args.length \u0026\u0026 !isGlobalInstall \u0026\u0026 !ignoreScripts) {',
  '      const scripts = [',
  '        \u0027preinstall\u0027,',
  '        \u0027install\u0027,',
  '        \u0027postinstall\u0027,',
  '        \u0027prepublish\u0027, // XXX(npm9) should we remove this finally??',
  '        \u0027preprepare\u0027,',
  '        \u0027prepare\u0027,',
  '        \u0027postprepare\u0027,',
  '      ]',
  '      for (const event of scripts) {',
  '        await runScript({',
  '          path: where,',
  '          args: [],',
  '          scriptShell,',
  '          stdio: \u0027inherit\u0027,',
  '          event,',
  '        })',
  '      }',
  '    }',
  '    await reifyFinish(this.npm, arb)',
  '  }',
  '}',
  '',
  'module.exports = Install',
  '',
].join('\r\n');
const sdkLoader =
  '  static cmd (c) {\r\n    const command = deref(c)\r\n    if (!command) {\r\n      throw Object.assign(new Error(`Unknown command ${c}`), {\r\n        code: \u0027EUNKNOWNCOMMAND\u0027,\r\n        command: c,\r\n      })\r\n    }\r\n    return require(`./commands/${command}.js`)\r\n  }\r\n\r\n';
const sha = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

describe('standalone npm10 install preload (actual transpiled module, mocked effects)', () => {
  const setup = () => {
    const filename = 'E:\\TEST app Việt\\npm10-install-preload.js';
    const packageDir = 'C:\\TEST SDK Việt\\npm';
    const entry = path.join(packageDir, 'bin/npm-cli.js');
    const loader = path.join(packageDir, 'lib/npm.js');
    const source = path.join(packageDir, 'lib/commands/install.js');
    const cwd = 'D:\\TEST project Việt';
    const preload = ts.transpileModule(
      readFileSync(join(__dirname, 'npm10-install-preload.ts'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2023,
        },
      },
    ).outputText;
    const files = new Map<string, Buffer>([
      [filename, Buffer.from(preload)],
      [entry, Buffer.from('// TEST native CLI')],
      [
        path.join(packageDir, 'package.json'),
        Buffer.from(JSON.stringify({ name: 'npm', version: '10.9.9' })),
      ],
      [loader, Buffer.from(sdkLoader)],
      [source, Buffer.from(sdkSource)],
    ]);
    const redirects = new Map<string, string>();
    const stats = (file: string) => ({
      dev: 1,
      ino: 1,
      size: files.get(file)?.length ?? 0,
      mtimeMs: 1,
      ctimeMs: 1,
      isFile: () => files.has(file),
      isDirectory: () => !files.has(file),
      isSymbolicLink: () => false,
    });
    const fs = {
      lstatSync: jest.fn(stats),
      realpathSync: jest.fn((file: string) => redirects.get(file) ?? file),
      openSync: jest.fn((file: string) => {
        if (!files.has(file)) throw new Error('TEST missing');
        return file;
      }),
      fstatSync: jest.fn(stats),
      readSync: jest.fn(
        (
          fd: string,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const bytes = files.get(fd)!;
          return bytes.copy(
            buffer,
            offset,
            position,
            Math.min(bytes.length, position + length),
          );
        },
      ),
      closeSync: jest.fn(),
    };
    const descriptor = () => ({
      schema: 1,
      entry,
      version: '10.9.9',
      sourceSha256: sha(files.get(source)!),
      loaderSha256: sha(files.get(loader)!),
      preloadSha256: sha(files.get(filename)!),
    });
    const env: Record<string, string> = {};
    const processMock = {
      env,
      execArgv: [
        '--trace-warnings',
        '--require',
        filename,
        '--stack-trace-limit=30',
      ],
      argv: [
        'C:\\TEST\\node.exe',
        entry,
        '--prefix',
        cwd,
        '--global=false',
        '--no-audit',
        '--no-fund',
        '--no-progress',
        '--update-notifier=false',
        'install',
      ],
      cwd: () => cwd,
      platform: 'win32',
      version: 'v24.19.0',
      versions: { node: '24.19.0' },
    };
    const effects = { add: null as unknown, lifecycle: [] as string[] };
    const imports = jest.fn();
    const cache: Record<string, { exports: unknown; loaded: boolean }> = {};
    let compileThrows = false;
    let consumption = true;
    let onCompile = () => {};
    let onDependency = () => {};
    class Parent {
      static params = [];
      constructor(public npm: unknown) {}
    }
    class Arborist {
      reify(options: { add: unknown }) {
        effects.add = options.add;
        return Promise.resolve();
      }
    }
    const sdkRequire = (id: string): unknown => {
      if (id === 'node:path') return path;
      if (id === 'node:fs/promises')
        return {
          readdir: jest.fn(() => {
            throw new Error('TEST unexpected effect');
          }),
        };
      if (id === 'proc-log') return { log: { warn: jest.fn() } };
      if (id === '@npmcli/run-script')
        return (options: { event: string }) => {
          effects.lifecycle.push(options.event);
        };
      if (id === 'pacote' || id === 'npm-install-checks') return {};
      if (id === '../utils/reify-finish.js') return () => {};
      if (id === '../arborist-cmd.js') {
        onDependency();
        return Parent;
      }
      if (id === '@npmcli/arborist') return Arborist;
      throw new Error('TEST unexpected SDK import: ' + id);
    };
    class MockModule {
      static _cache = cache;
      static _nodeModulePaths = jest.fn((dir: string) => [
        path.join(dir, 'node_modules'),
      ]);
      filename = '';
      paths: string[] = [];
      exports: unknown = {};
      loaded = false;
      constructor(public id: string) {}
      _compile(text: string, file: string) {
        onCompile();
        if (compileThrows) throw new Error('TEST compile failure');
        runInNewContext(
          text,
          {
            module: this,
            exports: this.exports,
            require: sdkRequire,
            process: processMock,
          },
          { filename: file },
        );
      }
    }
    const resolve = jest.fn(() => source);
    const sdkImport = Object.assign(
      jest.fn((id: string) => {
        imports(id);
        expect(Object.keys(env)).not.toEqual(
          expect.arrayContaining(['PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT']),
        );
        expect(processMock.execArgv).toEqual([
          '--trace-warnings',
          '--stack-trace-limit=30',
        ]);
        return {
          cmd: () => (consumption ? cache[source].exports : class Foreign {}),
        };
      }),
      { resolve },
    );
    const createRequire = jest.fn(() => sdkImport);
    let isMainThread = true;
    const run = (
      edit?: (descriptor: ReturnType<typeof descriptor>) => unknown,
      omitDescriptor = false,
    ) => {
      const value = descriptor();
      if (!omitDescriptor)
        env.PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT = JSON.stringify(
          edit ? edit(value) : value,
        );
      env.pkgsteward_runner_npm10_install_compat_extra = 'TEST inherited';
      runInNewContext(
        preload,
        {
          __filename: filename,
          __dirname: path.dirname(filename),
          module: { exports: {} },
          exports: {},
          process: processMock,
          Buffer,
          TextDecoder,
          require(id: string) {
            if (id === 'node:fs') return fs;
            if (id === 'node:path') return path;
            if (id === 'node:crypto') return { createHash };
            if (id === 'node:module')
              return { Module: MockModule, createRequire };
            if (id === 'node:util') return { TextDecoder };
            if (id === 'node:worker_threads') return { isMainThread };
            throw new Error('TEST nonbuiltin preload import: ' + id);
          },
        },
        { filename },
      );
    };
    return {
      filename,
      packageDir,
      entry,
      loader,
      source,
      cwd,
      preload,
      files,
      redirects,
      fs,
      env,
      processMock,
      effects,
      imports,
      cache,
      run,
      resolve,
      createRequire,
      setWorker: () => {
        isMainThread = false;
      },
      setCompileThrows: () => {
        compileThrows = true;
      },
      setConsumption: () => {
        consumption = false;
      },
      onCompile: (fn: () => void) => {
        onCompile = fn;
      },
      onDependency: (fn: () => void) => {
        onDependency = fn;
      },
    };
  };
  it('passivates a native inherited Worker preload without reading or importing SDK code', () => {
    const f = setup();
    f.setWorker();
    const argv = [...f.processMock.argv];
    expect(() => f.run(undefined, true)).not.toThrow();
    expect(f.processMock.execArgv).toEqual([
      '--trace-warnings',
      '--stack-trace-limit=30',
    ]);
    expect(f.processMock.argv).toEqual(argv);
    expect(Object.keys(f.env)).toEqual([]);
    expect(f.fs.lstatSync).not.toHaveBeenCalled();
    expect(f.fs.openSync).not.toHaveBeenCalled();
    expect(f.createRequire).not.toHaveBeenCalled();
    expect(f.imports).not.toHaveBeenCalled();
    expect(f.cache).toEqual({});
  });
  it('continues to refuse a main-thread preload without a descriptor', () => {
    const f = setup();
    expect(() => f.run(undefined, true)).toThrow();
    expect(f.fs.openSync).not.toHaveBeenCalled();
    expect(f.imports).not.toHaveBeenCalled();
  });
  it('refuses an unexpected descriptor in a Worker before SDK reads or imports', () => {
    const f = setup();
    f.setWorker();
    expect(() => f.run()).toThrow();
    expect(f.fs.lstatSync).not.toHaveBeenCalled();
    expect(f.fs.openSync).not.toHaveBeenCalled();
    expect(f.createRequire).not.toHaveBeenCalled();
    expect(f.imports).not.toHaveBeenCalled();
    expect(Object.keys(f.env)).toEqual([]);
  });
  it('compiles guarded SDK bytes, cleans owned metadata and preserves native argv', async () => {
    const f = setup();
    const argv = [...f.processMock.argv];
    f.run();
    expect(f.createRequire).toHaveBeenCalledWith(f.loader);
    expect(f.resolve).toHaveBeenCalledWith('./commands/install.js');
    expect(f.processMock.argv).toEqual(argv);
    expect(Object.keys(f.env)).toEqual([]);
    const Install = f.cache[f.source].exports as new (npm: unknown) => {
      exec(args: string[]): Promise<void>;
    };
    await new Install({
      global: false,
      prefix: f.cwd,
      globalDir: path.join(f.cwd, 'node_modules'),
      flatOptions: { global: false },
      config: { get: () => false },
    }).exec([]);
    expect(Array.from(f.effects.add as string[])).toEqual([]);
    expect(f.effects.lifecycle).toEqual([
      'preinstall',
      'install',
      'postinstall',
      'prepublish',
      'preprepare',
      'prepare',
      'postprepare',
    ]);
    expect(f.cache[f.source].loaded).toBe(true);
    expect(f.files.get(f.source)!.toString()).toBe(sdkSource);
  });
  it.each(['loaded', 'loading'])(
    'refuses %s cache collision before SDK imports',
    (state) => {
      const f = setup();
      f.cache[f.source] = { exports: {}, loaded: state === 'loaded' };
      expect(() => f.run()).toThrow();
      expect(f.imports).not.toHaveBeenCalled();
    },
  );
  it('inserts loading placeholder before compilation and removes only its own failed entry', () => {
    const f = setup();
    f.onCompile(() => {
      expect(f.cache[f.source].loaded).toBe(false);
    });
    f.setCompileThrows();
    expect(() => f.run()).toThrow('TEST compile failure');
    expect(f.cache[f.source]).toBeUndefined();
    expect(f.imports).not.toHaveBeenCalled();
  });
  it('makes the loading placeholder available to a circular SDK dependency', () => {
    const f = setup();
    let circularExport: unknown;
    f.onDependency(() => {
      expect(f.cache[f.source].loaded).toBe(false);
      circularExport = f.cache[f.source].exports;
    });
    f.run();
    expect(circularExport).toEqual({});
    expect(circularExport).not.toBe(f.cache[f.source].exports);
  });
  it('does not delete a foreign cache replacement when compilation throws', () => {
    const f = setup();
    const foreign = { exports: {}, loaded: true };
    f.onCompile(() => {
      f.cache[f.source] = foreign;
    });
    f.setCompileThrows();
    expect(() => f.run()).toThrow('TEST compile failure');
    expect(f.cache[f.source]).toBe(foreign);
  });
  it('requires actual SDK command consumption before continuing to native CLI', () => {
    const f = setup();
    f.setConsumption();
    expect(() => f.run()).toThrow();
    expect(f.cache[f.source]).toBeUndefined();
  });
  it.each([
    'sourceSha256',
    'loaderSha256',
    'preloadSha256',
    'version',
    'entry',
    'schema',
  ])('refuses invalid descriptor %s before SDK imports', (field) => {
    const f = setup();
    expect(() =>
      f.run((value) => ({ ...value, [field]: 'TEST invalid' })),
    ).toThrow();
    expect(f.imports).not.toHaveBeenCalled();
    expect(Object.keys(f.env)).toEqual([]);
  });
  it.each([null, [], {}, { schema: 1 }])(
    'refuses malformed descriptor %p without leaking env',
    (descriptor) => {
      const f = setup();
      expect(() => f.run(() => descriptor)).toThrow();
      expect(f.imports).not.toHaveBeenCalled();
      expect(Object.keys(f.env)).toEqual([]);
    },
  );
  it.each(['source', 'loader', 'filename'] as const)(
    'refuses hash drift in %s before SDK imports',
    (asset) => {
      const f = setup();
      expect(() =>
        f.run((descriptor) => {
          f.files.set(
            f[asset],
            Buffer.concat([
              f.files.get(f[asset])!,
              Buffer.from('\n// TEST drift'),
            ]),
          );
          return descriptor;
        }),
      ).toThrow();
      expect(f.imports).not.toHaveBeenCalled();
    },
  );
  it.each(['update', 'i', 'install extra', '--global=true'])(
    'refuses nonexact install argv %s before SDK imports',
    (action) => {
      const f = setup();
      f.processMock.argv[f.processMock.argv.length - 1] = action;
      expect(() => f.run()).toThrow();
      expect(f.imports).not.toHaveBeenCalled();
    },
  );
  it.each(['source', 'loader', 'filename', 'entry'] as const)(
    'refuses redirected %s before SDK imports',
    (asset) => {
      const f = setup();
      f.redirects.set(f[asset], 'E:\\TEST\\elsewhere');
      expect(() => f.run()).toThrow();
      expect(f.imports).not.toHaveBeenCalled();
    },
  );
  it('refuses a redirected ancestor and prefix/cwd mismatch before SDK imports', () => {
    const f = setup();
    f.redirects.set(path.dirname(f.source), 'E:\\TEST\\elsewhere');
    expect(() => f.run()).toThrow();
    expect(f.imports).not.toHaveBeenCalled();
    const g = setup();
    g.processMock.argv[3] = 'D:\\TEST wrong root';
    expect(() => g.run()).toThrow();
    expect(g.imports).not.toHaveBeenCalled();
  });
  it.each(['missing', 'malformed', 'oversize', 'identity drift'])(
    'refuses %s source before SDK imports',
    (problem) => {
      const f = setup();
      if (problem === 'missing') f.files.delete(f.source);
      if (problem === 'malformed') f.files.set(f.source, Buffer.from([0xff]));
      if (problem === 'oversize')
        f.files.set(f.source, Buffer.alloc(1024 * 1024 + 1));
      if (problem === 'identity drift') {
        const normalStat = f.fs.fstatSync.getMockImplementation()!;
        f.fs.fstatSync.mockImplementation((file) => ({
          ...normalStat(file),
          ino: file === f.source ? 2 : 1,
        }));
      }
      expect(() => f.run()).toThrow();
      expect(f.imports).not.toHaveBeenCalled();
    },
  );
  it('refuses a native resolved command key outside the checked source', () => {
    const f = setup();
    f.resolve.mockReturnValue(path.join(f.packageDir, 'lib/foreign.js'));
    expect(() => f.run()).toThrow();
    expect(f.imports).not.toHaveBeenCalled();
  });
  it('refuses mismatching package name/version before SDK imports', () => {
    const f = setup();
    f.files.set(
      path.join(f.packageDir, 'package.json'),
      Buffer.from('{"name":"foreign","version":"10.9.9"}'),
    );
    expect(() => f.run()).toThrow();
    expect(f.imports).not.toHaveBeenCalled();
  });
  it.each([
    (s: string) =>
      s.replace('if (where === globalTop && !args.length)', 'if (true)'),
    (s: string) => s + '\n// if (where === globalTop && !args.length)',
    (s: string) =>
      s.replace(
        'const isGlobalInstall = this.npm.global',
        'const isGlobalInstall = true',
      ),
    (s: string) =>
      s.replace(
        'if (!args.length && !isGlobalInstall && !ignoreScripts)',
        'if (false)',
      ),
  ])('refuses unknown install shape before SDK imports', (edit) => {
    const f = setup();
    f.files.set(f.source, Buffer.from(edit(sdkSource)));
    expect(() => f.run()).toThrow();
    expect(f.imports).not.toHaveBeenCalled();
  });
  it('refuses changed loader dispatch seam before SDK imports', () => {
    const f = setup();
    f.files.set(
      f.loader,
      Buffer.from(
        sdkLoader.replace('const command = deref(c)', 'const command = c'),
      ),
    );
    expect(() => f.run()).toThrow();
    expect(f.imports).not.toHaveBeenCalled();
  });
});
