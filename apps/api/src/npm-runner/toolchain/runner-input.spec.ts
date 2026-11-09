import { readFileSync } from 'node:fs';
import { join, win32 as path } from 'node:path';
import {
  readRunnerInput,
  revalidateRunnerInput,
} from '@/npm-runner/toolchain/runner-input';
import { buildRunCommand } from '@/npm-runner/execution/runner-command';
import { ForbiddenException } from '@/common/exceptions/app.exception';
import {
  fileStat,
  fsFixture,
  key,
  root,
  tool,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import type {
  IRunnerInput,
  IRunnerInputDeps,
} from '@/npm-runner/interfaces/npm-runner.types';
import type { ProjectScanSnapshot } from '@/projects/interfaces/projects.types';

const fixtureText = (name: string) =>
  readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');
const manifest = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'TEST-project',
    dependencies: { alpha: '^1.0.0' },
    scripts: { dev: 'echo TEST' },
    ...extra,
  });
const setup = () => {
  const f = fsFixture();
  const read = (
    request = root,
    scan: ProjectScanSnapshot | null = f.scan,
    deps: IRunnerInputDeps = f.deps,
  ) => Promise.resolve().then(() => readRunnerInput(request, scan, deps));
  const revalidate = (
    previous: IRunnerInput,
    expectedHash = previous.inputHash,
  ) =>
    Promise.resolve().then(() =>
      revalidateRunnerInput(previous, expectedHash, f.deps),
    );
  return { ...f, read, revalidate };
};

describe('runner input: guarded current filesystem, scan and hash', () => {
  it('uses exact current scan membership, canonical cwd and fresh manifest rather than scan PM metadata', async () => {
    const f = setup();
    f.put(
      path.join(root, 'package.json'),
      fixtureText('commands/manifest.json'),
    );
    const input = await f.read(root.toUpperCase());
    expect(input.path.toLowerCase()).toBe(root.toLowerCase());
    expect(input.requestPath).toBe(root.toUpperCase());
    expect(input.scanId).toBe(f.scan.scanId);
    expect(input.manager).toBe('npm');
    expect(input.manifest.name).toBe('TEST-command-project');
    expect(input.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(input.warnings).toContain('NO_LOCKFILE');
    expect(f.assertAllowed).toHaveBeenCalledWith(
      path.resolve(root.toUpperCase()),
    );
  });
  it.each([
    '',
    'D:relative',
    '\\rooted',
    '\\\\host\\share',
    '\\\\?\\D:\\project',
    'D:\\TEST\\..\\project',
    'D:\\TEST\\x\0',
    'D:\\TEST\\x\r',
    'D:\\TEST\\x\n',
  ])('rejects malformed path before IO: %p', async (request) => {
    const f = setup();
    await expect(f.read(request)).rejects.toThrow();
    expect(f.open).not.toHaveBeenCalled();
  });
  it('requires a scan and exact membership, not a parent/child or prefix match', async () => {
    const f = setup();
    await expect(f.read(root, null)).rejects.toThrow();
    for (const request of [
      'D:\\TEST',
      path.join(root, 'child'),
      `${root}-other`,
    ]) {
      await expect(f.read(request)).rejects.toMatchObject({
        details: { reason: 'PROJECT_NOT_SCANNED' },
      });
    }
    expect(f.open).not.toHaveBeenCalled();
  });
  it('propagates the shared guard refusal without opening client files', async () => {
    const f = setup();
    f.assertAllowed.mockRejectedValueOnce(new Error('TEST denied'));
    await expect(f.read()).rejects.toThrow('TEST denied');
    expect(f.open).not.toHaveBeenCalled();
  });
  it('rejects a missing/malformed manifest', async () => {
    const f = setup();
    f.remove(path.join(root, 'package.json'));
    await expect(f.read()).rejects.toThrow();
    f.put(path.join(root, 'package.json'), 'TEST invalid JSON');
    await expect(f.read()).rejects.toThrow();
  });
  it.each(['root', 'manifest'] as const)(
    'refuses a visible %s symlink/junction',
    async (target) => {
      const f = setup();
      const file = target === 'root' ? root : path.join(root, 'package.json');
      const before = f.stats.get(key(file))!;
      f.stats.set(key(file), { ...before, isSymbolicLink: () => true });
      await expect(f.read()).rejects.toThrow();
      expect(f.events).not.toContain(
        `read:${key(path.join(root, 'package.json'))}`,
      );
    },
  );
  it('refuses an outside manifest realpath before opening it', async () => {
    const f = setup();
    const file = path.join(root, 'package.json');
    f.realpaths.set(key(file), 'E:\\OUTSIDE\\package.json');
    await expect(f.read()).rejects.toThrow();
    expect(f.events).not.toContain(`open:${key(file)}`);
  });
  it('F4: compares prechecked identity with opened fstat before consuming any wrong-inode bytes', async () => {
    const f = setup();
    const file = path.join(root, 'package.json');
    const before = f.stats.get(key(file))!;
    f.openedStats.set(key(file), { ...before, ino: before.ino + 1 });
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
    expect(f.events).not.toContain(`read:${key(file)}`);
    expect(f.close).toHaveBeenCalled();
  });
  it('closes a handle and rejects an observed parent swap after open', async () => {
    const f = setup();
    const file = path.join(root, 'package.json');
    f.onEvent((event) => {
      if (event === `open:${key(file)}`)
        f.realpaths.set(key(root), 'E:\\OUTSIDE');
    });
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
    expect(f.close).toHaveBeenCalled();
  });
  it('does not claim the remaining cwd/spawn parent-swap gap is closed', async () => {
    const f = setup();
    const input = await f.read();
    expect(input.warnings).toContain('PATH_RACE_RESIDUAL');
    // This read is a snapshot. No cwd-bound handle or Windows process containment exists.
    f.realpaths.set(key(root), 'E:\\OUTSIDE');
    expect(input.path.toLowerCase()).toBe(root.toLowerCase());
    await expect(f.revalidate(input)).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
  });
  it.each(['ino', 'dev', 'mtimeMs', 'ctimeMs', 'size'] as const)(
    'detects changed %s after a read',
    async (field) => {
      const f = setup();
      const file = path.join(root, 'package.json');
      f.onEvent((event) => {
        if (event === `read:${key(file)}`) {
          const before = f.stats.get(key(file))!;
          f.stats.set(key(file), { ...before, [field]: before[field] + 1 });
        }
      });
      await expect(f.read()).rejects.toMatchObject({
        details: { reason: 'INPUT_CHANGED' },
      });
    },
  );
  it('hashes root/scan/manifest and absence, presence and bytes of every fixed marker', async () => {
    const f = setup();
    const initial = await f.read();
    expect((await f.read()).inputHash).toBe(initial.inputHash);
    const markers = [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      '.npmrc',
      '.yarnrc',
      '.yarnrc.yml',
      'pnpm-workspace.yaml',
    ];
    for (const marker of markers) {
      const file = path.join(root, marker);
      const text = marker.endsWith('.json')
        ? '{}'
        : marker.endsWith('.yaml')
          ? 'packages: []\n'
          : '# TEST marker\n';
      f.put(file, text);
      const present = await f.read();
      expect(present.inputHash).not.toBe(initial.inputHash);
      f.put(file, `${text}\n`);
      expect((await f.read()).inputHash).not.toBe(present.inputHash);
      f.remove(file);
      expect((await f.read()).inputHash).toBe(initial.inputHash);
    }
    f.scan.scanId = '00000000-0000-4000-8000-000000000002';
    expect((await f.read()).inputHash).not.toBe(initial.inputHash);
    f.put(path.join(root, 'package.json'), `${manifest()}\n`);
    expect((await f.read()).inputHash).not.toBe(initial.inputHash);
  });
  it('includes the canonical root and selected distribution identity/version in the hash', async () => {
    const f = setup();
    const initial = await f.read();
    f.resolveTool.mockResolvedValue({ ...tool(), version: '11.18.0' });
    expect((await f.read()).inputHash).not.toBe(initial.inputHash);
    const changed = tool();
    changed.identities[0].stat = fileStat(1, { ino: 99 });
    f.resolveTool.mockResolvedValue(changed);
    expect((await f.read()).inputHash).not.toBe(initial.inputHash);
    f.resolveTool.mockResolvedValue(tool());
    const other = 'D:\\TEST\\other';
    f.put(path.join(other, 'package.json'), manifest());
    f.scan.projects[0].path = other;
    expect((await f.read(other)).inputHash).not.toBe(initial.inputHash);
  });
  it('rejects stale expected hash and a changed latest scan before launch', async () => {
    const f = setup();
    const previous = await f.read();
    await expect(f.revalidate(previous, 'b'.repeat(64))).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
    f.scan.scanId = '00000000-0000-4000-8000-000000000002';
    await expect(f.revalidate(previous)).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
  });
  it('re-reads script own-property and command text; removed/changed scripts invalidate input', async () => {
    const f = setup();
    const previous = await f.read();
    f.put(
      path.join(root, 'package.json'),
      manifest({ scripts: { dev: 'echo TEST changed' } }),
    );
    await expect(f.revalidate(previous)).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
    f.put(path.join(root, 'package.json'), manifest({ scripts: {} }));
    await expect(f.revalidate(previous)).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
  });
  it.each([
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
  ] as const)(
    'selects %s family as %s without trusting scan metadata',
    async (marker, manager) => {
      const f = setup();
      f.put(
        path.join(root, marker),
        marker.endsWith('.json') ? '{}' : '# TEST',
      );
      const input = await f.read();
      expect(input.manager).toBe(manager);
      if (manager === 'yarn') expect(input.reason).toBe('UNSUPPORTED_MANAGER');
      else expect(input.reason).toBeNull();
    },
  );
  it('treats shrinkwrap/package-lock as one npm family and refuses multiple unpinned families', async () => {
    const f = setup();
    f.put(path.join(root, 'package-lock.json'), '{}');
    f.put(path.join(root, 'npm-shrinkwrap.json'), '{}');
    expect((await f.read()).manager).toBe('npm');
    f.put(path.join(root, 'pnpm-lock.yaml'), '# TEST');
    expect(await f.read()).toMatchObject({
      manager: 'ambiguous',
      reason: 'UNSUPPORTED_MANAGER',
    });
  });
  it('refuses a pin with any conflicting lock family even if its own lock exists', async () => {
    const f = setup();
    f.put(
      path.join(root, 'package.json'),
      manifest({ packageManager: 'npm@11.17.0' }),
    );
    f.put(path.join(root, 'package-lock.json'), '{}');
    f.put(path.join(root, 'pnpm-lock.yaml'), '# TEST');
    expect((await f.read()).reason).toBe('LOCKFILE_MISMATCH');
  });
  it.each([
    'yarn@1.22.22',
    'yarn@4.0.0',
    'npm@invalid',
    'bun@1.0.0',
    'npm@^11.0.0',
    '',
  ])('refuses unsupported/bogus pin %p', async (packageManager) => {
    const f = setup();
    f.put(path.join(root, 'package.json'), manifest({ packageManager }));
    expect((await f.read()).reason).toBe('UNSUPPORTED_MANAGER');
  });
  it.each(['npm', 'pnpm'] as const)(
    'uses %s same-major pins with warning, refuses different major',
    async (manager) => {
      const f = setup();
      f.put(
        path.join(root, 'package.json'),
        manifest({ packageManager: `${manager}@11.0.0+sha512.TEST` }),
      );
      const input = await f.read();
      expect(input).toMatchObject({
        manager,
        reason: null,
      });
      expect(input.warnings).toContain('PACKAGE_MANAGER_PIN_DIFFERS');
      f.put(
        path.join(root, 'package.json'),
        manifest({ packageManager: `${manager}@10.0.0` }),
      );
      expect((await f.read()).reason).toBe('TOOL_VERSION_MISMATCH');
      f.put(
        path.join(root, 'package.json'),
        manifest({ packageManager: `${manager}@${tool(manager).version}` }),
      );
      expect((await f.read()).warnings).not.toContain(
        'PACKAGE_MANAGER_PIN_DIFFERS',
      );
    },
  );
  it.each(['.yarnrc.yml', 'yarn.lock'])(
    'detects Yarn marker %s without parsing config/plugins',
    async (marker) => {
      const f = setup();
      f.put(path.join(root, marker), 'TEST deliberately not YAML');
      expect((await f.read()).reason).toBe('UNSUPPORTED_MANAGER');
      expect(f.resolveTool).not.toHaveBeenCalled();
    },
  );
  it.each([
    'global=true',
    'GLOBAL = true',
    'prefix=C:\\outside',
    'location=global',
    'dir=../outside',
    'modules-dir=../outside',
    'virtual-store-dir=C:/outside',
    'lockfile-dir=../outside',
    'manage-package-manager-versions=true',
    'managePackageManagerVersions=true',
    'yarn-path=../tool.js',
    'yarnPath: ../tool.js',
  ])('refuses local redirect/version-substitution config %p', async (text) => {
    const f = setup();
    f.put(path.join(root, '.npmrc'), text);
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
  });
  it('permits normal registry/credential data without leaking contents in results', async () => {
    const f = setup();
    f.put(
      path.join(root, '.npmrc'),
      'registry=https://TEST.example/\n//TEST.example/:_authToken=TEST-private-token\n',
    );
    const input = await f.read();
    expect(input.reason).toBeNull();
    expect(JSON.stringify(input)).not.toContain('TEST-private-token');
  });
  it('refuses a hostile npmrc fixture without leaking its path/config text', async () => {
    const f = setup();
    f.put(path.join(root, '.npmrc'), fixtureText('hostile/prefix.npmrc'));
    const input = await f.read();
    expect(input.reason).toBe('CONFIG_UNSUPPORTED');
    expect(JSON.stringify(input)).not.toContain('D:\\TEST\\outside');
  });
  it('makes a missing tool safe unavailable metadata rather than fake npm', async () => {
    const f = setup();
    f.put(path.join(root, 'pnpm-lock.yaml'), '# TEST');
    f.resolveTool.mockRejectedValue(
      Object.assign(new Error('TEST absent'), {
        details: { reason: 'TOOL_NOT_FOUND' },
      }),
    );
    expect(await f.read()).toMatchObject({
      manager: 'pnpm',
      tool: null,
      reason: 'TOOL_NOT_FOUND',
    });
  });
});

describe('runner bounded ancestors/workspaces and cancellation', () => {
  it.each([false, true])(
    'stops exclusively at a forbidden drive boundary with roots * (workspace=%s)',
    async (workspace) => {
      const f = setup();
      const request = 'D:\\work\\app';
      f.put(path.join(request, 'package.json'), manifest());
      f.put(
        'D:\\work\\package.json',
        manifest(workspace ? { workspaces: ['app'] } : {}),
      );
      f.put('D:\\package.json', manifest({ packageManager: 'yarn@4.0.0' }));
      f.scan.projects[0].path = request;
      f.deps.scanRoots = ['*'];
      f.assertAllowed.mockImplementation((value: string): Promise<string> =>
        key(value) === key('D:\\')
          ? Promise.reject(new ForbiddenException('TEST ancestor boundary'))
          : Promise.resolve(path.resolve(value)),
      );
      const input = await f.read(request);
      expect(input.reason).toBeNull();
      expect(input.workspace).toEqual(
        workspace
          ? { kind: 'leaf', root: 'D:\\work' }
          : { kind: 'standalone', root: null },
      );
      expect(f.events).toContain(`read:${key('D:\\work\\package.json')}`);
      for (const operation of ['lstat', 'realpath', 'open', 'read']) {
        expect(f.events).not.toContain(`${operation}:${key('D:\\')}`);
        expect(f.events).not.toContain(
          `${operation}:${key('D:\\package.json')}`,
        );
      }
      expect(
        input.identities.some((identity) => key(identity.path) === key('D:\\')),
      ).toBe(false);
    },
  );
  it('fails closed when ancestor guard rejection is not ForbiddenException', async () => {
    const f = setup();
    const request = 'D:\\work\\app';
    f.put(path.join(request, 'package.json'), manifest());
    f.scan.projects[0].path = request;
    f.deps.scanRoots = ['*'];
    f.assertAllowed.mockImplementation((value: string): Promise<string> =>
      key(value) === key('D:\\work')
        ? Promise.reject(new Error('TEST guard IO failure'))
        : Promise.resolve(path.resolve(value)),
    );
    expect((await f.read(request)).reason).toBe('CONFIG_UNSUPPORTED');
    expect(f.events).not.toContain(`open:${key('D:\\work\\package.json')}`);
  });
  it('recognizes package.json root workspaces and permits root commands', async () => {
    const f = setup();
    f.put(
      path.join(root, 'package.json'),
      fixtureText('workspaces/workspace-root.json'),
    );
    const input = await f.read();
    expect(input.workspace).toEqual({ kind: 'root', root: input.path });
    expect(input.reason).toBeNull();
    expect(
      buildRunCommand(input, {
        path: root,
        action: 'install_all',
        inputHash: input.inputHash,
        requestId: '00000000-0000-4000-8000-000000000001',
      }).cwd,
    ).toBe(input.path);
  });
  it('recognizes pnpm YAML workspaces at the root', async () => {
    const f = setup();
    f.put(
      path.join(root, 'pnpm-workspace.yaml'),
      fixtureText('workspaces/packages.yaml'),
    );
    expect((await f.read()).workspace.kind).toBe('root');
  });
  it('recognizes a matching leaf without redirecting cwd or requiring the ancestor to be scanned', async () => {
    const f = setup();
    f.put(
      'D:\\TEST\\package.json',
      manifest({ workspaces: ['project', 'other/*'] }),
    );
    const input = await f.read();
    expect(input.workspace).toEqual({ kind: 'leaf', root: 'D:\\TEST' });
    expect(input.path.toLowerCase()).toBe(root.toLowerCase());
    expect(input.reason).toBeNull();
  });
  it('does not label a nonmatching sibling as a workspace leaf', async () => {
    const f = setup();
    f.put('D:\\TEST\\package.json', manifest({ workspaces: ['other/*'] }));
    expect((await f.read()).workspace.kind).toBe('standalone');
  });
  it.each([
    '../outside',
    'a/../b',
    'C:\\outside',
    '/outside',
    '\\\\host\\share',
  ])('rejects escaping/absolute workspace glob %p', async (glob) => {
    const f = setup();
    f.put(path.join(root, 'package.json'), manifest({ workspaces: [glob] }));
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
    f.remove(path.join(root, 'package.json'));
    f.put(path.join(root, 'package.json'), manifest());
    f.put(
      path.join(root, 'pnpm-workspace.yaml'),
      `packages:\n  - ${JSON.stringify(glob)}\n`,
    );
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
  });
  it('rejects malformed workspace/config marker data', async () => {
    const f = setup();
    f.put(path.join(root, 'pnpm-workspace.yaml'), 'packages: [unterminated');
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
    f.remove(path.join(root, 'pnpm-workspace.yaml'));
    f.put(path.join(root, 'package.json'), manifest({ workspaces: 42 }));
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
  });
  it('does not read above a scan root, recurse directories, or leave the allowlist', async () => {
    const f = setup();
    f.put('D:\\package.json', manifest({ workspaces: ['TEST/*'] }));
    const input = await f.read();
    expect(input.workspace.kind).toBe('standalone');
    const inspected = f.events.filter((event) =>
      /^(?:open|lstat|realpath|guard):/.test(event),
    );
    expect(
      inspected.some((event) => event === `open:${key('D:\\package.json')}`),
    ).toBe(false);
    expect(
      inspected.every((event) =>
        event.slice(event.indexOf(':') + 1).startsWith(key('D:\\TEST')),
      ),
    ).toBe(true);
  });
  it('fails closed on unreadable/inconclusive ancestor metadata instead of skipping it', async () => {
    const f = setup();
    const original = f.lstat.getMockImplementation()!;
    f.lstat.mockImplementation((value) =>
      key(value) === key('D:\\TEST\\package.json')
        ? Promise.reject(
            Object.assign(new Error('TEST denied'), { code: 'EACCES' }),
          )
        : original(value),
    );
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
  });
  it('requires a safe ancestor boundary and refuses an ancestor link', async () => {
    const f = setup();
    f.stats.set(
      key('D:\\TEST'),
      fileStat(0, {
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => true,
      }),
    );
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
  });
  it('bounds each ancestor marker at 1MiB and rejects before consuming oversize bytes', async () => {
    const f = setup();
    const marker = 'D:\\TEST\\package.json';
    f.put(marker, '{}');
    f.stats.set(key(marker), fileStat(1024 * 1024 + 1));
    expect((await f.read()).reason).toBe('CONFIG_UNSUPPORTED');
    expect(f.events).not.toContain(`read:${key(marker)}`);
  });
  it('bounds a root manifest at 1MiB, including streaming growth beyond the prechecked size', async () => {
    const f = setup();
    const marker = path.join(root, 'package.json');
    f.put(marker, ' '.repeat(1024 * 1024 + 1));
    await expect(f.read()).rejects.toThrow();
    expect(f.events).not.toContain(`read:${key(marker)}`);
    f.stats.set(key(marker), fileStat(2));
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'CONFIG_UNSUPPORTED' },
    });
    expect(f.close).toHaveBeenCalled();
  });
  it('caps all bounded ancestor marker reads at 8MiB total', async () => {
    const f = setup();
    const deep = `D:\\TEST\\${Array.from({ length: 10 }, (_, i) => `p${i}`).join('\\')}`;
    f.put(path.join(deep, 'package.json'), manifest());
    f.scan.projects[0].path = deep;
    for (
      let at = path.dirname(deep);
      key(at) !== key('D:\\TEST');
      at = path.dirname(at)
    ) {
      f.put(path.join(at, 'package.json'), `{${' '.repeat(1024 * 1024 - 2)}}`);
    }
    expect((await f.read(deep)).reason).toBe('CONFIG_UNSUPPORTED');
    const bytesRead =
      f.events.filter((event) => event.startsWith('read:')).length * 65536;
    expect(bytesRead).toBeLessThanOrEqual(8 * 1024 * 1024 + 65536);
  });
  it('caps ancestors at 256 without scanning or glob-expanding directories', async () => {
    const f = setup();
    const deep = `D:\\TEST\\${Array.from({ length: 257 }, () => 'p').join('\\')}`;
    f.put(path.join(deep, 'package.json'), manifest());
    f.scan.projects[0].path = deep;
    expect((await f.read(deep)).reason).toBe('CONFIG_UNSUPPORTED');
  });
  it('accepts exactly 1MiB root manifest data', async () => {
    const f = setup();
    const text = manifest();
    f.put(
      path.join(root, 'package.json'),
      text + ' '.repeat(1024 * 1024 - Buffer.byteLength(text)),
    );
    expect((await f.read()).manifest.name).toBe('TEST-project');
  });
  it('hashes ancestor workspace bytes, including presence changes', async () => {
    const f = setup();
    const initial = await f.read();
    f.put('D:\\TEST\\package.json', manifest({ workspaces: ['project'] }));
    expect((await f.read()).inputHash).not.toBe(initial.inputHash);
    await expect(f.revalidate(initial)).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
  });
  it.each(['guard:', 'lstat:', 'realpath:', 'open:', 'fstat:', 'read:'])(
    'checks cancellation after awaited %s IO and closes opened handles',
    async (prefix) => {
      const f = setup();
      f.onEvent((event) => {
        if (event.startsWith(prefix)) f.controller.abort();
      });
      await expect(f.read()).rejects.toMatchObject({ name: 'AbortError' });
      if (['open:', 'fstat:', 'read:'].includes(prefix))
        expect(f.close).toHaveBeenCalled();
    },
  );
  it('checks cancellation after tool resolution and before any further IO', async () => {
    const f = setup();
    f.resolveTool.mockImplementation((manager) => {
      f.controller.abort();
      return Promise.resolve(tool(manager));
    });
    await expect(f.read()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
