import { readFileSync } from 'node:fs';
import { join, win32 as path } from 'node:path';
import {
  resolveRunnerTool,
  revalidateRunnerTool,
} from '@/npm-runner/toolchain/runner-tool';
import {
  fileStat,
  fsFixture,
  key,
  nodeFile,
  npmDir,
  pnpmPrefix,
  root,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import type { ProjectManager } from '@/projects/interfaces/projects.types';

jest.mock('execa', () => ({ execa: jest.fn() }));

describe('installed runner tool resolver (static data only)', () => {
  afterEach(() => {
    expect(
      jest.requireMock<{ execa: unknown }>('execa').execa,
    ).not.toHaveBeenCalled();
  });
  const setup = (manager: ProjectManager = 'npm') => {
    const f = fsFixture();
    const resolve = () =>
      Promise.resolve().then(() =>
        resolveRunnerTool(manager, f.snapshot, f.fs),
      );
    return { ...f, resolve };
  };
  const setupNpm12 = () => {
    const f = setup();
    const installed = f.installTool('npm', '12.2.2');
    f.snapshot.nodeVersion = '24.19.0';
    return { ...f, installed };
  };
  it('resolves sibling npm 12 statically with canonical Node, JS entry and identities', async () => {
    const f = setupNpm12();
    const result = await f.resolve();
    expect(result).toMatchObject({
      manager: 'npm',
      version: '12.2.2',
      file: nodeFile,
      entry: f.installed.entry,
      packageDir: npmDir,
    });
    expect(result.identities.map((identity) => key(identity.path))).toEqual([
      key(nodeFile),
      key(path.join(npmDir, 'package.json')),
      key(f.installed.entry!),
      key(npmDir),
    ]);
    await expect(
      revalidateRunnerTool(result, f.fs, f.controller.signal),
    ).resolves.toBeUndefined();
  });
  it.each(['24.15.0', '24.19.0', '22.22.2', '26.0.0'])(
    'accepts npm 12 with compatible backend Node %s',
    async (nodeVersion) => {
      const f = setupNpm12();
      f.snapshot.nodeVersion = nodeVersion;
      expect((await f.resolve()).version).toBe('12.2.2');
    },
  );
  it.each(['24.14.9', '22.22.1', '25.0.0', 'invalid', '', '24.15.0-rc.1'])(
    'refuses npm 12 with incompatible/invalid backend Node %p',
    async (nodeVersion) => {
      const f = setupNpm12();
      f.snapshot.nodeVersion = nodeVersion;
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'TOOL_VERSION_MISMATCH' },
      });
    },
  );
  it.each([
    undefined,
    null,
    {},
    { node: '' },
    { node: '   ' },
    { node: 24 },
    { node: 'invalid range' },
  ])('refuses missing/malformed npm 12 engines %p', async (engines) => {
    const f = setupNpm12();
    f.put(
      path.join(npmDir, 'package.json'),
      JSON.stringify({
        name: 'npm',
        version: '12.2.2',
        bin: { npm: 'bin/npm-cli.js' },
        engines,
      }),
    );
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
    });
  });
  it('reads the actual engine range and defaults to the backend process Node', async () => {
    const f = setupNpm12();
    delete f.snapshot.nodeVersion;
    f.snapshot.env = {
      PATH: pnpmPrefix,
      NODE_VERSION: '0.0.1',
      npm_config_node_version: '0.0.1',
    };
    const manifest = (node: string) =>
      JSON.stringify({
        name: 'npm',
        version: '12.2.2',
        bin: { npm: 'bin/npm-cli.js' },
        engines: { node },
      });
    f.put(path.join(npmDir, 'package.json'), manifest(process.versions.node));
    expect((await f.resolve()).version).toBe('12.2.2');
    f.put(path.join(npmDir, 'package.json'), manifest('0.0.1'));
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_VERSION_MISMATCH' },
    });
  });
  it('ignores an npm 12 PATH/prefix overlay in favor of sibling npm 11', async () => {
    const f = setup();
    f.installTool('npm');
    const overlay = path.join(pnpmPrefix, 'node_modules', 'npm');
    f.put(
      path.join(overlay, 'package.json'),
      JSON.stringify({
        name: 'npm',
        version: '12.2.2',
        bin: { npm: 'bin/npm-cli.js' },
        engines: { node: '*' },
      }),
    );
    f.put(
      path.join(overlay, 'bin', 'npm-cli.js'),
      '// TEST overlay, never executed',
    );
    f.snapshot.env = { PATH: pnpmPrefix, npm_config_prefix: pnpmPrefix };
    expect((await f.resolve()).version).toBe('11.17.0');
    f.remove(path.join(npmDir, 'package.json'));
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_NOT_FOUND' },
    });
    expect(f.events).not.toContain(
      `open:${key(path.join(overlay, 'package.json'))}`,
    );
  });
  it.each(['12.0.0-pre.1', '13.0.0'])(
    'refuses sibling npm %s without trying an overlay',
    async (version) => {
      const f = setupNpm12();
      f.installTool('npm', version);
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'TOOL_VERSION_MISMATCH' },
      });
    },
  );
  it('keeps pnpm 12 unsupported', async () => {
    const f = setup('pnpm');
    f.installTool('pnpm', '12.0.0');
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_VERSION_MISMATCH' },
    });
  });
  it.each([
    ['npm', '11.0.0-pre.1'],
    ['pnpm', '11.0.0-pre.1'],
    ['npm', '11.17.0+TEST'],
    ['pnpm', '11.22.0+TEST'],
    ['npm', 'v11.17.0'],
    ['pnpm', 'v11.22.0'],
  ] as const)(
    'retains %s %s normalization without requiring Node engines',
    async (manager, version) => {
      const f = setup(manager);
      f.installTool(manager, version);
      f.snapshot.nodeVersion = 'invalid';
      expect((await f.resolve()).version).toBe(version);
    },
  );
  it.each(['metadata', 'entry'] as const)(
    'detects npm 12 %s replacement during resolution',
    async (part) => {
      const f = setupNpm12();
      const target =
        part === 'metadata'
          ? path.join(npmDir, 'package.json')
          : f.installed.entry!;
      let observations = 0;
      f.onEvent((event) => {
        if (event !== `lstat:${key(target)}` || ++observations !== 2) return;
        const before = f.stats.get(key(target))!;
        f.stats.set(key(target), { ...before, ino: before.ino + 1 });
      });
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'INPUT_CHANGED' },
      });
    },
  );
  it('revalidates every npm 12 identity before use', async () => {
    const f = setupNpm12();
    const selected = await f.resolve();
    for (const identity of selected.identities) {
      const before = f.stats.get(key(identity.path))!;
      f.stats.set(key(identity.path), { ...before, ino: before.ino + 1 });
      await expect(
        revalidateRunnerTool(selected, f.fs, f.controller.signal),
      ).rejects.toMatchObject({ details: { reason: 'INPUT_CHANGED' } });
      f.stats.set(key(identity.path), before);
    }
  });
  it.each(['../../escape.js', 'C:\\TEST\\evil.js', 'bin/npm.cmd'])(
    'retains npm 12 bin containment for %p',
    async (bin) => {
      const f = setupNpm12();
      f.put(
        path.join(npmDir, 'package.json'),
        JSON.stringify({
          name: 'npm',
          version: '12.2.2',
          bin: { npm: bin },
          engines: { node: '*' },
        }),
      );
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
      });
    },
  );
  it.each(['package', 'entry', 'node'] as const)(
    'refuses npm 12 %s junctions into a scanned project',
    async (part) => {
      const f = setupNpm12();
      const source =
        part === 'package'
          ? npmDir
          : part === 'entry'
            ? f.installed.entry!
            : nodeFile;
      const target =
        part === 'node'
          ? path.join(root, 'node.exe')
          : part === 'entry'
            ? path.join(root, 'evil.js')
            : root;
      f.put(target, 'TEST untrusted bytes');
      f.realpaths.set(key(source), target);
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
      });
    },
  );
  it('refuses npm 12 when the backend Node is selected from a .bin directory', async () => {
    const f = setupNpm12();
    const untrusted = 'E:\\TEST\\node_modules\\.bin\\node.exe';
    f.put(untrusted, 'TEST untrusted Node, never executed');
    f.snapshot.execPath = untrusted;
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
    });
    expect(f.open).not.toHaveBeenCalled();
  });
  it.each([
    ['npm', '11.17.0'],
    ['pnpm', '11.22.0'],
    ['npm', '12.2.2'],
  ] as const)(
    'resolves %s %s through a linked nvm Node directory and launches canonical paths',
    async (manager, version) => {
      const f = setup(manager);
      const installed = f.installTool(manager, version);
      f.snapshot.nodeVersion = '24.19.0';
      const canonicalNodeDir =
        'C:\\Users\\TEST\\AppData\\Roaming\\nvm\\v24.19.0';
      const canonicalNode = path.join(canonicalNodeDir, 'node.exe');
      f.put(canonicalNode, 'TEST canonical Node');
      f.realpaths.set(key(nodeFile), canonicalNode);
      f.realpaths.set(key(path.dirname(nodeFile)), canonicalNodeDir);
      const packageDir =
        manager === 'npm'
          ? path.join(canonicalNodeDir, 'node_modules', 'npm')
          : installed.packageDir;
      const entry = path.join(
        packageDir,
        'bin',
        manager === 'npm' ? 'npm-cli.js' : 'pnpm.mjs',
      );
      f.put(
        path.join(packageDir, 'package.json'),
        f.files
          .get(key(path.join(installed.packageDir, 'package.json')))!
          .toString('utf8'),
      );
      f.put(entry, '// TEST canonical distribution entry');
      const result = await f.resolve();
      expect(result).toMatchObject({ file: canonicalNode, entry, packageDir });
      expect(
        result.identities.some(
          (identity) => key(identity.path) === key(nodeFile),
        ),
      ).toBe(false);
      await expect(
        revalidateRunnerTool(result, f.fs, f.controller.signal),
      ).resolves.toBeUndefined();
    },
  );
  it('refuses a linked Node directory targeting a scanned project', async () => {
    const f = setup();
    f.installTool('npm');
    const target = path.join(root, 'node.exe');
    f.put(target, 'TEST untrusted Node');
    f.realpaths.set(key(nodeFile), target);
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
    });
    expect(f.events).not.toContain(`lstat:${key(target)}`);
  });
  it('canonicalizes linked PATH prefixes and deduplicates the resolved distribution', async () => {
    const f = setup('pnpm');
    f.installTool('pnpm');
    const targetPrefix = 'E:\\MachineTools\\npm';
    const packageDir = path.join(targetPrefix, 'node_modules', 'pnpm');
    const metadata = path.join(packageDir, 'package.json');
    const entry = path.join(packageDir, 'bin', 'pnpm.mjs');
    f.put(
      metadata,
      readFileSync(
        join(__dirname, '..', '__fixtures__', 'tools', 'pnpm-package.json'),
        'utf8',
      ),
    );
    f.put(entry, '// TEST canonical pnpm');
    f.realpaths.set(key(pnpmPrefix), targetPrefix);
    f.snapshot.env = { PATH: `${pnpmPrefix};${targetPrefix}` };
    expect(await f.resolve()).toMatchObject({ entry, packageDir });
    expect(
      f.events.filter((event) => event === `open:${key(metadata)}`),
    ).toHaveLength(1);
  });
  it('refuses a linked PATH prefix targeting a scanned project before reading metadata', async () => {
    const f = setup('pnpm');
    f.installTool('pnpm');
    f.realpaths.set(key(pnpmPrefix), root);
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
    });
    expect(f.open).not.toHaveBeenCalled();
  });
  it.each(['npm', 'pnpm'] as const)(
    'resolves the observed %s 11 bin field through the pinned Node executable',
    async (manager) => {
      const f = setup(manager);
      const installed = f.installTool(manager);
      const result = await f.resolve();
      expect(result).toMatchObject({
        manager,
        version: installed.version,
        file: nodeFile,
        entry: installed.entry,
        packageDir: installed.packageDir,
      });
      expect(result.identities.map((item) => key(item.path))).toEqual(
        expect.arrayContaining([
          key(nodeFile),
          key(installed.entry!),
          key(path.join(installed.packageDir, 'package.json')),
        ]),
      );
      expect(result.file).not.toMatch(/\.(?:cmd|bat|ps1|mjs|js)$/i);
    },
  );
  it.each(['11.17.0', '12.2.2'])(
    'ignores hostile cwd shims, Node binaries, shebangs and PATH .bin for npm %s',
    async (version) => {
      const f = setup();
      f.installTool('npm', version);
      f.snapshot.nodeVersion = '24.19.0';
      for (const name of ['npm.exe', 'npm.cmd', 'npm.ps1', 'node.exe', 'npm'])
        f.put(
          path.join(root, name),
          '#!/usr/bin/env node\nthrow new Error("TEST hostile")',
        );
      f.snapshot.env = {
        PATH: `;.;relative;${root};${root}\\node_modules\\.bin;${pnpmPrefix}`,
      };
      expect((await f.resolve()).file).toBe(nodeFile);
      expect(
        f.events
          .filter((event) => event.startsWith('open:'))
          .some((event) => event.includes(key(root))),
      ).toBe(false);
    },
  );
  it('uses static pnpm bin metadata rather than executing the PATH shim', async () => {
    const f = setup('pnpm');
    f.installTool('pnpm');
    f.put(
      path.join(pnpmPrefix, 'pnpm.cmd'),
      '@echo off\r\necho TEST DO NOT EXECUTE',
    );
    f.put(path.join(pnpmPrefix, 'pnpm'), '#!/usr/bin/env node\nTEST');
    expect((await f.resolve()).entry).toBe(
      path.join(pnpmPrefix, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    );
    expect(f.events).not.toContain(
      `open:${key(path.join(pnpmPrefix, 'pnpm'))}`,
    );
  });
  it('drops unsafe/case-duplicate PATH entries and preserves first supported distribution order', async () => {
    const f = setup('pnpm');
    const installed = f.installTool('pnpm');
    const second = 'D:\\Tools';
    f.put(
      path.join(second, 'node_modules', 'pnpm', 'package.json'),
      JSON.stringify({
        name: 'pnpm',
        version: '11.9.0',
        bin: { pnpm: 'bin/pnpm.mjs' },
      }),
    );
    f.put(
      path.join(second, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
      '// TEST',
    );
    f.snapshot.env = {
      path: `;.;relative;C:relative;\\rooted;\\\\host\\share;${pnpmPrefix};${pnpmPrefix.toUpperCase()};${second}`,
    };
    const result = await f.resolve();
    expect(result.version).toBe(installed.version);
    const opens = f.events.filter(
      (event) =>
        event ===
        `open:${key(path.join(installed.packageDir, 'package.json'))}`,
    );
    expect(opens).toHaveLength(1);
    expect(
      f.events.some(
        (event) => event.includes('relative') || event.includes('host\\share'),
      ),
    ).toBe(false);
  });
  it('does not inspect a project-controlled ancestor on PATH', async () => {
    const f = setup('pnpm');
    f.installTool('pnpm');
    f.snapshot.env = { PATH: `D:\\TEST;${pnpmPrefix}` };
    f.put(
      'D:\\TEST\\node_modules\\pnpm\\package.json',
      '{"name":"pnpm","version":"11.0.0","bin":{"pnpm":"bin/pnpm.mjs"}}',
    );
    expect((await f.resolve()).packageDir).toBe(
      path.join(pnpmPrefix, 'node_modules', 'pnpm'),
    );
    expect(f.events).not.toContain(
      `open:${key('D:\\TEST\\node_modules\\pnpm\\package.json')}`,
    );
  });
  it.each(['yarn', 'unknown', 'ambiguous'] as const)(
    'refuses %s without pretending npm is available',
    async (manager) => {
      const f = setup(manager);
      f.installTool('npm');
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'UNSUPPORTED_MANAGER' },
      });
      expect(f.open).not.toHaveBeenCalled();
    },
  );
  it('refuses Corepack-only layouts without searching caches or downloading', async () => {
    const f = setup('pnpm');
    f.put(nodeFile, 'TEST Node');
    f.put(
      path.join(pnpmPrefix, 'pnpm.cmd'),
      readFileSync(
        join(__dirname, '..', '__fixtures__', 'tools', 'corepack-shim.cmd.txt'),
        'utf8',
      ),
    );
    f.put(
      path.join(pnpmPrefix, 'node_modules', 'corepack', 'dist', 'pnpm.js'),
      'throw new Error("TEST never import")',
    );
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_NOT_FOUND' },
    });
    expect(
      f.events
        .filter((event) => event.startsWith('open:'))
        .some((event) => event.includes('corepack') || event.includes('cache')),
    ).toBe(false);
  });
  it('refuses standalone pnpm.exe lacking matching adjacent distribution metadata', async () => {
    const f = setup('pnpm');
    f.put(nodeFile, 'TEST');
    f.put(path.join(pnpmPrefix, 'pnpm.exe'), 'TEST never execute');
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_NOT_FOUND' },
    });
  });
  it.each([
    '../../escape.js',
    'C:\\TEST\\evil.js',
    '..\\..\\escape.js',
    'bin/npm.cmd',
    'bin/npm.ps1',
  ])('refuses escaping/non-JS bin %p', async (bin) => {
    const f = setup();
    f.installTool('npm');
    f.put(
      path.join(npmDir, 'package.json'),
      JSON.stringify({ name: 'npm', version: '11.17.0', bin: { npm: bin } }),
    );
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
    });
    expect(f.events).not.toContain(`open:${key('C:\\TEST\\evil.js')}`);
  });
  it.each([
    '{}',
    'not json',
    '{"name":"corepack","version":"11.0.0","bin":{"npm":"bin/npm-cli.js"}}',
    '{"name":"npm","version":"11.invalid","bin":{"npm":"bin/npm-cli.js"}}',
    '{"name":"npm","version":"11.0.0","bin":{"npm":42}}',
  ])(
    'refuses malformed/foreign metadata without evaluating it: %p',
    async (text) => {
      const f = setup();
      f.installTool('npm');
      f.put(path.join(npmDir, 'package.json'), text);
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
      });
    },
  );
  it('refuses unsupported major metadata', async () => {
    const f = setup();
    f.installTool('npm');
    f.put(
      path.join(npmDir, 'package.json'),
      '{"name":"npm","version":"10.0.0","bin":{"npm":"bin/npm-cli.js"}}',
    );
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_VERSION_MISMATCH' },
    });
  });
  it('bounds metadata reads before opening oversized files', async () => {
    const f = setup();
    f.installTool('npm');
    f.stats.set(
      key(path.join(npmDir, 'package.json')),
      fileStat(1024 * 1024 + 1),
    );
    await expect(f.resolve()).rejects.toThrow();
    expect(f.events).not.toContain(
      `read:${key(path.join(npmDir, 'package.json'))}`,
    );
  });
  it('refuses package/bin junctions into a scanned project', async () => {
    const f = setup('pnpm');
    const installed = f.installTool('pnpm');
    f.realpaths.set(key(installed.entry!), path.join(root, 'evil.mjs'));
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
    });
    expect(f.events).not.toContain(`read:${key(installed.entry!)}`);
  });
  it.each(['11.17.0', '12.2.2'])(
    'refuses npm %s bin symlinks or realpaths escaping its distribution outside scanned roots',
    async (version) => {
      const f = setup();
      const installed = f.installTool('npm', version);
      f.snapshot.nodeVersion = '24.19.0';
      f.realpaths.set(key(installed.entry!), 'E:\\Tools\\other.mjs');
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
      });
      f.realpaths.clear();
      const before = f.stats.get(key(installed.entry!))!;
      f.stats.set(key(installed.entry!), {
        ...before,
        isSymbolicLink: () => true,
      });
      await expect(f.resolve()).rejects.toMatchObject({
        details: { reason: 'TOOL_LAYOUT_UNSUPPORTED' },
      });
    },
  );
  it('refuses a Node executable selected from a project-controlled path', async () => {
    const f = setup();
    f.installTool('npm');
    f.snapshot.execPath = path.join(root, 'node.exe');
    f.put(f.snapshot.execPath, 'TEST');
    await expect(f.resolve()).rejects.toThrow();
  });
  it('rejects opened metadata identity mismatch before reading bytes', async () => {
    const f = setup();
    f.installTool('npm');
    const metadata = path.join(npmDir, 'package.json');
    f.openedStats.set(
      key(metadata),
      fileStat(f.files.get(key(metadata))!.length, { ino: 999 }),
    );
    await expect(f.resolve()).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
    expect(f.events).not.toContain(`read:${key(metadata)}`);
    expect(f.close).toHaveBeenCalled();
  });
  it('revalidates entry, metadata and Node identity immediately before use', async () => {
    const f = setup();
    f.installTool('npm');
    const selected = await f.resolve();
    await expect(
      revalidateRunnerTool(selected, f.fs, f.controller.signal),
    ).resolves.toBeUndefined();
    for (const identity of selected.identities) {
      const before = f.stats.get(key(identity.path))!;
      f.stats.set(key(identity.path), { ...before, ino: before.ino + 1 });
      await expect(
        revalidateRunnerTool(selected, f.fs, f.controller.signal),
      ).rejects.toMatchObject({ details: { reason: 'INPUT_CHANGED' } });
      f.stats.set(key(identity.path), before);
    }
  });
  it('honors an aborted signal before static IO', async () => {
    const f = setup();
    f.controller.abort();
    await expect(f.resolve()).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.open).not.toHaveBeenCalled();
  });
});
