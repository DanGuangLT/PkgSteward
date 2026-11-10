import { readFileSync } from 'node:fs';
import { join, win32 as path } from 'node:path';
import { readProjectInput } from '@/projects/input/project-input';
import type {
  IProjectFileStat,
  IProjectInputDeps,
  ProjectScanSnapshot,
} from '@/projects/interfaces/projects.types';

jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('node:fs/promises', () => ({
  writeFile: jest.fn(),
  rm: jest.fn(),
  unlink: jest.fn(),
  mkdir: jest.fn(),
}));

const fixtureText = (name: string) =>
  readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');
const errno = (code: string) =>
  Object.assign(new Error(`TEST ${code}`), { code });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const key = (value: string) => path.resolve(value).toLowerCase();
const stat = (
  size: number,
  overrides: Partial<IProjectFileStat> = {},
): IProjectFileStat => ({
  size,
  mtimeMs: 1,
  ctimeMs: 1,
  ino: 2,
  dev: 1,
  isFile: () => true,
  isSymbolicLink: () => false,
  ...overrides,
});
const fixture = () => {
  const root = 'D:\\TEST\\project';
  const files = new Map<string, Buffer>();
  const stats = new Map<string, IProjectFileStat>();
  const realpaths = new Map<string, string>();
  const events: string[] = [];
  const put = (name: string, text: string) => {
    const file = key(path.join(root, name));
    files.set(file, Buffer.from(text));
    stats.set(file, stat(Buffer.byteLength(text)));
  };
  put(
    'package.json',
    JSON.stringify({
      name: 'TEST-root',
      version: '1.0.0',
      dependencies: { alpha: '^1.0.0' },
    }),
  );
  const assertAllowed = jest.fn((value: string): Promise<string> => {
    events.push(`guard:${key(value)}`);
    return Promise.resolve(realpaths.get(key(value)) ?? path.resolve(value));
  });
  const lstat = jest.fn((value: string): Promise<IProjectFileStat> => {
    events.push(`lstat:${key(value)}`);
    const result = stats.get(key(value));
    return result ? Promise.resolve(result) : Promise.reject(errno('ENOENT'));
  });
  const realpath = jest.fn((value: string): Promise<string> => {
    events.push(`realpath:${key(value)}`);
    return Promise.resolve(realpaths.get(key(value)) ?? path.resolve(value));
  });
  const readChunks = jest.fn(async function* (
    value: string,
    signal: AbortSignal,
  ) {
    events.push(`read:${key(value)}`);
    const bytes = files.get(key(value));
    if (!bytes) throw errno('ENOENT');
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      await Promise.resolve();
      signal.throwIfAborted();
      yield bytes.subarray(offset, offset + 64 * 1024);
    }
  });
  const deps: IProjectInputDeps = {
    platform: 'win32',
    fs: { lstat, realpath, readChunks },
    assertAllowed,
    now: () => new Date('2026-11-02T10:30:00.000Z'),
  };
  const scan: ProjectScanSnapshot = {
    scanId: '00000000-0000-4000-8000-000000000001',
    projects: [
      {
        path: root,
        name: 'TEST-old-scan-name',
        packageManager: 'yarn',
        hasLockfile: false,
        lastActivityAt: '2026-11-01T00:00:00.000Z',
        nodeModules: {
          exists: false,
          path: path.join(root, 'node_modules'),
          sizeBytes: null,
          sizeMeasuredAt: null,
        },
      },
    ],
  };
  const controller = new AbortController();
  const read = (request = root, snapshot: ProjectScanSnapshot | null = scan) =>
    readProjectInput(request, snapshot, controller.signal, deps);
  return {
    root,
    files,
    stats,
    realpaths,
    events,
    put,
    deps,
    scan,
    controller,
    read,
    assertAllowed,
    lstat,
    realpath,
    readChunks,
  };
};

describe('readProjectInput', () => {
  beforeEach(() => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(errno('TEST_NETWORK_FORBIDDEN'));
  });
  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('guards before any file IO and reads current manifest independently of scanner hints', async () => {
    const f = fixture();
    const input = await f.read();
    expect(f.events[0]).toBe(`guard:${key(f.root)}`);
    expect(f.assertAllowed).toHaveBeenCalledTimes(1);
    for (const event of f.events.filter((value) => value.startsWith('read:'))) {
      const file = event.slice('read:'.length);
      expect(f.events.indexOf(`realpath:${file}`)).toBeLessThan(
        f.events.indexOf(event),
      );
    }
    expect(input).toMatchObject({
      path: f.root,
      requestPath: f.root,
      scanId: f.scan.scanId,
      manager: 'unknown',
      lock: null,
      registryPolicy: null,
      manifest: { name: 'TEST-root', version: '1.0.0' },
      readAt: '2026-11-02T10:30:00.000Z',
    });
    expect(input.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('performs no read when root guard rejects', async () => {
    const f = fixture();
    f.assertAllowed.mockRejectedValueOnce(errno('FORBIDDEN'));
    await expect(f.read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.lstat).not.toHaveBeenCalled();
    expect(f.readChunks).not.toHaveBeenCalled();
  });
  it('requires an existing latest scan', async () => {
    const f = fixture();
    await expect(f.read(f.root, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(f.readChunks).not.toHaveBeenCalled();
  });
  it.each(['D:\\TEST\\project\\child', 'D:\\TEST\\project-other'])(
    'rejects descendants and prefix siblings absent exact scan membership: %s',
    async (request) => {
      const f = fixture();
      await expect(f.read(request)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'PROJECT_NOT_SCANNED' },
      });
      expect(f.readChunks).not.toHaveBeenCalled();
    },
  );
  it('matches canonical scan paths case-insensitively and retains lexical request', async () => {
    const f = fixture();
    const request = 'd:\\test\\PROJECT\\.';
    const input = await f.read(request);
    expect(key(input.path)).toBe(key(f.root));
    expect(input.requestPath).toBe(request);
  });
  it('allows an authorized root junction matching a canonical scan entry', async () => {
    const f = fixture();
    const alias = 'D:\\TEST\\alias';
    f.realpaths.set(key(alias), f.root);
    const input = await f.read(alias);
    expect(key(input.path)).toBe(key(f.root));
    expect(input.requestPath).toBe(alias);
  });
  it.each(['request', 'canonical'] as const)(
    'calls the guard exactly once with 300 scan entries and a matching %s path',
    async (match) => {
      const f = fixture();
      const alias = 'D:\\TEST\\alias';
      f.realpaths.set(key(alias), f.root);
      const scanned = f.scan.projects[0];
      f.scan.projects = Array.from({ length: 300 }, (_, index) => ({
        ...scanned,
        path: `D:\\TEST\\unrelated-${index}`,
      }));
      f.scan.projects[299].path = match === 'request' ? alias : f.root;
      const input = await f.read(alias);
      expect(input.path).toBe(f.root);
      expect(f.assertAllowed).toHaveBeenCalledTimes(1);
      expect(f.assertAllowed).toHaveBeenCalledWith(path.resolve(alias));
    },
  );
  it.each([
    'package.json',
    'package-lock.json',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    'pnpm-workspace.yaml',
  ])(
    'refuses a fixed file escaping canonical root even if guard would allow destination: %s',
    async (name) => {
      const f = fixture();
      if (name !== 'package.json') f.put(name, '{}');
      f.realpaths.set(
        key(path.join(f.root, name)),
        'D:\\TEST\\other-allowed\\secret',
      );
      f.stats.set(
        key(path.join(f.root, name)),
        stat(2, { isSymbolicLink: () => true }),
      );
      if (name === 'package.json') {
        await expect(f.read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      } else {
        const input = await f.read();
        expect(input.manifest.name).toBe('TEST-root');
        expect(input.lock).toBeNull();
        expect(input.warningCodes).toContain('UNREADABLE_INPUT');
        expect(input.registryPolicy).toBe(
          name === 'package-lock.json' ? null : 'REGISTRY_CONFIG_UNSUPPORTED',
        );
      }
      expect(
        f.readChunks.mock.calls.some(
          ([file]) => key(file) === key(path.join(f.root, name)),
        ),
      ).toBe(false);
    },
  );
  it('rejects a nonregular manifest before reading', async () => {
    const f = fixture();
    f.stats.set(
      key(path.join(f.root, 'package.json')),
      stat(0, { isFile: () => false }),
    );
    await expect(f.read()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(f.readChunks).not.toHaveBeenCalled();
  });
  it('reports missing required manifest as NOT_FOUND', async () => {
    const f = fixture();
    f.stats.delete(key(path.join(f.root, 'package.json')));
    await expect(f.read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it.each([
    '{',
    'null',
    '[]',
    '{"dependencies":[]}',
    '{"dependencies":{"alpha":5}}',
    '{"scripts":{"test":{}}}',
  ])(
    'rejects malformed/schema-invalid manifest without leaking text: %s',
    async (text) => {
      const f = fixture();
      f.put('package.json', text);
      await expect(f.read()).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    },
  );
  it('normalizes unreadable input without exposing raw filesystem failures', async () => {
    const f = fixture();
    f.readChunks.mockImplementationOnce(async function* () {
      await Promise.reject(errno('EACCES'));
      yield Buffer.alloc(0);
    });
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'UNREADABLE_INPUT' },
    });
  });
  it('preserves every duplicate dependency declaration and inert scripts; ignores plugin fields', async () => {
    const f = fixture();
    f.put('package.json', fixtureText('hostile/package.json.txt'));
    const input = await f.read();
    expect(input.manifest).toEqual({
      name: 'TEST-inert-input',
      version: '1.0.0',
      packageManager: 'pnpm@11.0.0',
      dependencies: [
        {
          name: 'alpha',
          declarations: [
            { group: 'dependencies', spec: '^1.0.0' },
            { group: 'devDependencies', spec: '~1.2.0' },
            { group: 'optionalDependencies', spec: '1.2.0' },
            { group: 'peerDependencies', spec: '>=1.0.0' },
          ],
        },
      ],
      scripts: [
        {
          name: 'postinstall',
          command: 'TEST do not execute $(whoami) & echo inert',
        },
      ],
    });
    expect(input.registryPolicy).toBeNull();
    const execa = jest.requireMock<{ execa: jest.Mock }>('execa');
    expect(execa.execa).not.toHaveBeenCalled();
    const fs =
      jest.requireMock<
        Record<'writeFile' | 'rm' | 'unlink' | 'mkdir', jest.Mock>
      >('node:fs/promises');
    for (const method of Object.values(fs))
      expect(method).not.toHaveBeenCalled();
    const allowed = new Set([
      'package.json',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      '.npmrc',
      '.yarnrc',
      '.yarnrc.yml',
      'pnpm-workspace.yaml',
    ]);
    expect(
      f.lstat.mock.calls.every(([file]) => allowed.has(path.basename(file))),
    ).toBe(true);
  });
  describe.each(['.npmrc', '.yarnrc', '.yarnrc.yml', 'pnpm-workspace.yaml'])(
    '%s text policy',
    (name) => {
      it.each([
        'ReGiStRy',
        'NpMrEgIsTrYsErVeR',
        'NpMScOpEs',
        '_AuTh',
        '_AuThToKeN',
        '_PaSsWoRd',
      ])(
        'blocks online for a case-insensitive key-name match: %s',
        async (keyName) => {
          const f = fixture();
          f.put(name, `# TEST inert\n${keyName}: TEST-placeholder`);
          const input = await f.read();
          expect(input.registryPolicy).toBe('REGISTRY_CONFIG_UNSUPPORTED');
          expect(input.warningCodes).toContain('REGISTRY_CONFIG_UNSUPPORTED');
          expect(input.manifest.name).toBe('TEST-root');
          expect(JSON.stringify(input)).not.toContain('TEST-placeholder');
        },
      );
      it.each(['# registry comment', 'registry=https://registry.npmjs.org/'])(
        'allows conservative false positives: %s',
        async (value) => {
          const f = fixture();
          f.put(name, value);
          expect((await f.read()).registryPolicy).toBe(
            'REGISTRY_CONFIG_UNSUPPORTED',
          );
        },
      );
      it('does not parse unrelated malformed config, execute interpolation or follow referenced paths', async () => {
        const f = fixture();
        f.put(
          name,
          '[[malformed!!\nyarnPath: ./TEST-plugin.cjs\nextends: ../TEST\nvalue: ${TEST_SECRET}\n',
        );
        expect((await f.read()).registryPolicy).toBeNull();
        expect(
          f.readChunks.mock.calls.some(([file]) =>
            file.includes('TEST-plugin'),
          ),
        ).toBe(false);
      });
    },
  );
  it.each(['package.json', '.npmrc'])(
    'rejects >1 MiB input based on stat before reading: %s',
    async (name) => {
      const f = fixture();
      f.put(name, '{}');
      f.stats.set(key(path.join(f.root, name)), stat(1024 * 1024 + 1));
      if (name === 'package.json') {
        await expect(f.read()).rejects.toMatchObject({
          details: { reason: 'LIMIT_EXCEEDED' },
        });
      } else {
        const input = await f.read();
        expect(input.registryPolicy).toBe('REGISTRY_CONFIG_UNSUPPORTED');
        expect(input.warningCodes).toContain('LIMIT_EXCEEDED');
      }
      expect(
        f.readChunks.mock.calls.some(([file]) => path.basename(file) === name),
      ).toBe(false);
    },
  );
  it('counts streamed UTF-8 bytes even when initial stat understates size', async () => {
    const f = fixture();
    f.put('.npmrc', 'é'.repeat(600_000));
    f.stats.set(key(path.join(f.root, '.npmrc')), stat(1));
    const input = await f.read();
    expect(input.registryPolicy).toBe('REGISTRY_CONFIG_UNSUPPORTED');
    expect(input.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('treats >32 MiB optional lock as absent without reading', async () => {
    const f = fixture();
    f.put('package-lock.json', '{}');
    f.stats.set(
      key(path.join(f.root, 'package-lock.json')),
      stat(32 * 1024 * 1024 + 1),
    );
    const input = await f.read();
    expect(input.manifest.name).toBe('TEST-root');
    expect(input.lock).toBeNull();
    expect(input.warningCodes).toContain('LIMIT_EXCEEDED');
    expect(
      f.readChunks.mock.calls.some(
        ([file]) => path.basename(file) === 'package-lock.json',
      ),
    ).toBe(false);
  });
  describe.each([
    'npm-shrinkwrap.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    'pnpm-workspace.yaml',
  ])('%s optional failures', (name) => {
    it.each([
      'oversized',
      'linked',
      'broken-link',
      'escaping',
      'unreadable',
      'invalid-utf8',
    ] as const)(
      'preserves detail and records a deterministic %s failure',
      async (failure) => {
        const f = fixture();
        const absent = await f.read();
        f.put(name, '{}');
        const file = key(path.join(f.root, name));
        if (failure === 'oversized') f.stats.set(file, stat(33 * 1024 * 1024));
        if (failure === 'linked')
          f.stats.set(file, stat(2, { isSymbolicLink: () => true }));
        if (failure === 'broken-link') {
          f.stats.set(
            file,
            stat(2, { isFile: () => false, isSymbolicLink: () => true }),
          );
          const original = f.realpath.getMockImplementation()!;
          f.realpath.mockImplementation((value) =>
            key(value) === file
              ? Promise.reject(errno('ENOENT'))
              : original(value),
          );
        }
        if (failure === 'escaping')
          f.realpaths.set(file, 'D:\\TEST\\outside\\input');
        if (failure === 'unreadable') {
          const original = f.lstat.getMockImplementation()!;
          f.lstat.mockImplementation((value) =>
            key(value) === file
              ? Promise.reject(errno('EACCES'))
              : original(value),
          );
        }
        if (failure === 'invalid-utf8')
          f.files.set(file, Buffer.from([0xc3, 0x28]));
        const first = await f.read();
        const second = await f.read();
        expect(first.manifest.name).toBe('TEST-root');
        expect(first.lock).toBeNull();
        const config = name.startsWith('.') || name === 'pnpm-workspace.yaml';
        expect(first.registryPolicy).toBe(
          config ? 'REGISTRY_CONFIG_UNSUPPORTED' : null,
        );
        expect(first.warningCodes).toContain(
          failure === 'oversized' ? 'LIMIT_EXCEEDED' : 'UNREADABLE_INPUT',
        );
        expect(first.inputHash).toBe(second.inputHash);
        expect(first.inputHash).not.toBe(absent.inputHash);
        expect(f.assertAllowed).toHaveBeenCalledTimes(3);
      },
    );
    it('does not swallow changed input', async () => {
      const f = fixture();
      f.put(name, '{}');
      const original = f.readChunks.getMockImplementation()!;
      f.readChunks.mockImplementation(async function* (file, signal) {
        yield* original(file, signal);
        if (path.basename(file) === name)
          f.realpaths.set(key(file), 'D:\\TEST\\outside\\changed');
      });
      await expect(f.read()).rejects.toMatchObject({
        details: { reason: 'INPUT_CHANGED' },
      });
    });
    it('does not swallow abort after a late optional read', async () => {
      const f = fixture();
      f.put(name, '{}');
      const original = f.readChunks.getMockImplementation()!;
      f.readChunks.mockImplementation(async function* (file, signal) {
        yield* original(file, signal);
        if (path.basename(file) === name) f.controller.abort();
      });
      await expect(f.read()).rejects.toMatchObject({ name: 'AbortError' });
    });
  });
  it('keeps invalid UTF-8 in the required manifest strict', async () => {
    const f = fixture();
    const file = key(path.join(f.root, 'package.json'));
    f.files.set(file, Buffer.from([0xc3, 0x28]));
    f.stats.set(file, stat(2));
    await expect(f.read()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it.each(['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'] as const)(
    'detects changed %s across bounded read/stat',
    async (field) => {
      const f = fixture();
      const original = f.lstat.getMockImplementation()!;
      let count = 0;
      f.lstat.mockImplementation((file) => {
        if (path.basename(file) === 'package.json' && ++count > 1) {
          const current = f.stats.get(key(file))!;
          return Promise.resolve({ ...current, [field]: current[field] + 1 });
        }
        return original(file);
      });
      await expect(f.read()).rejects.toMatchObject({
        details: { reason: 'INPUT_CHANGED' },
      });
    },
  );
  it('detects realpath replacement after a file read', async () => {
    const f = fixture();
    const original = f.readChunks.getMockImplementation()!;
    f.readChunks.mockImplementation(async function* (file, signal) {
      yield* original(file, signal);
      if (path.basename(file) === 'package.json')
        f.realpaths.set(key(file), 'D:\\TEST\\outside\\package.json');
    });
    await expect(f.read()).rejects.toMatchObject({
      details: { reason: 'INPUT_CHANGED' },
    });
  });
  it('hashes root, scan identity, raw manifest/selected lock/config bytes and absence markers deterministically', async () => {
    const f = fixture();
    const initial = await f.read();
    expect((await f.read()).inputHash).toBe(initial.inputHash);
    f.scan.scanId = '00000000-0000-4000-8000-000000000002';
    const newScan = await f.read();
    expect(newScan.inputHash).not.toBe(initial.inputHash);
    f.put(
      'package.json',
      f.files.get(key(path.join(f.root, 'package.json')))!.toString() + ' ',
    );
    const newManifest = await f.read();
    expect(newManifest.inputHash).not.toBe(newScan.inputHash);
    f.put('.npmrc', '');
    const presentEmpty = await f.read();
    expect(presentEmpty.inputHash).not.toBe(newManifest.inputHash);
    f.put('.npmrc', '# unrelated');
    const changedConfig = await f.read();
    expect(changedConfig.inputHash).not.toBe(presentEmpty.inputHash);
    f.put('package-lock.json', fixtureText('npm-v3/package-lock.json'));
    const newLock = await f.read();
    expect(newLock.inputHash).not.toBe(changedConfig.inputHash);
    f.put('package-lock.json', fixtureText('npm-v3/package-lock.json') + ' ');
    expect((await f.read()).inputHash).not.toBe(newLock.inputHash);
  });
  it('does not hash lexical junction aliases or timestamps as new input', async () => {
    const f = fixture();
    const first = await f.read();
    const alias = 'D:\\TEST\\alias';
    f.realpaths.set(key(alias), f.root);
    f.deps.now = () => new Date('2026-11-03T00:00:00Z');
    expect((await f.read(alias)).inputHash).toBe(first.inputHash);
  });
  it.each([
    ['package-lock.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
  ] as const)(
    'detects a single local lock family %s without consulting executable availability',
    async (name, manager) => {
      const f = fixture();
      f.put(name, '# TEST data only');
      const input = await f.read();
      expect(input.manager).toBe(manager);
      expect(input.lock?.name).toBe(name);
    },
  );
  it('reports ambiguous lock families without choosing an arbitrary audit source', async () => {
    const f = fixture();
    f.put('package-lock.json', '{}');
    f.put('yarn.lock', '# TEST');
    const input = await f.read();
    expect(input.manager).toBe('ambiguous');
    expect(input.lock).toBeNull();
    expect(input.warningCodes).toContain('LOCKFILE_MISMATCH');
  });
  it('uses a recognized packageManager pin to select the matching family', async () => {
    const f = fixture();
    f.put('package.json', '{"packageManager":"pnpm@11.0.0+sha512.TEST"}');
    f.put('pnpm-lock.yaml', '# TEST');
    f.put('package-lock.json', '{}');
    f.put('yarn.lock', '# TEST');
    const input = await f.read();
    expect(input.manager).toBe('pnpm');
    expect(input.lock?.name).toBe('pnpm-lock.yaml');
  });
  it('gives npm-shrinkwrap precedence within the npm family', async () => {
    const f = fixture();
    f.put('npm-shrinkwrap.json', '{"TEST":"shrinkwrap"}');
    f.put('package-lock.json', '{"TEST":"lock"}');
    const input = await f.read();
    expect(input.manager).toBe('npm');
    expect(input.lock).toEqual({
      name: 'npm-shrinkwrap.json',
      text: '{"TEST":"shrinkwrap"}',
    });
  });
  describe('explicit npm 12 lock selection', () => {
    const npm12 = () => {
      const f = fixture();
      f.put(
        'package.json',
        JSON.stringify({
          name: 'TEST-npm12',
          description: 'không phải yêu cầu nghiệp vụ',
          packageManager: 'npm@12.2.2',
          dependencies: { alpha: '^1.0.0' },
        }),
      );
      return f;
    };
    it.each(['npm@12.0.0', 'npm@12.2.2', 'npm@12.2.2+sha512.TEST'])(
      'selects package-lock with both npm locks for %s',
      async (packageManager) => {
        const f = npm12();
        f.put('package.json', JSON.stringify({ packageManager }));
        const text = fixtureText('npm12/package-lock.json');
        f.put('package-lock.json', text);
        f.put('npm-shrinkwrap.json', '{"TEST":"ignored shrinkwrap"}');
        f.put('pnpm-lock.yaml', '# TEST');
        f.put('yarn.lock', '# TEST');
        const input = await f.read();
        expect(input.manager).toBe('npm');
        expect(input.lock).toEqual({ name: 'package-lock.json', text });
        expect(input.warningCodes).toEqual([]);
      },
    );
    it('reports NO_LOCKFILE for shrinkwrap alone', async () => {
      const f = npm12();
      f.put('npm-shrinkwrap.json', fixtureText('npm12/package-lock.json'));
      const input = await f.read();
      expect(input.manager).toBe('npm');
      expect(input.lock).toBeNull();
      expect(input.warningCodes).toEqual(['NO_LOCKFILE']);
    });
    it('keeps other lock families mismatched without package-lock', async () => {
      const f = npm12();
      f.put('npm-shrinkwrap.json', '{}');
      f.put('pnpm-lock.yaml', '# TEST');
      const input = await f.read();
      expect(input.manager).toBe('npm');
      expect(input.lock).toBeNull();
      expect(input.warningCodes).toEqual(['LOCKFILE_MISMATCH']);
    });
    it.each([false, true])(
      'hashes ignored shrinkwrap bytes/absence with package-lock present=%s',
      async (withPackageLock) => {
        const f = npm12();
        if (withPackageLock)
          f.put('package-lock.json', fixtureText('npm12/package-lock.json'));
        const absent = await f.read();
        f.put('npm-shrinkwrap.json', '{"TEST":"first"}');
        const first = await f.read();
        f.put('npm-shrinkwrap.json', '{"TEST":"other"}');
        const changed = await f.read();
        expect(first.inputHash).not.toBe(absent.inputHash);
        expect(changed.inputHash).not.toBe(first.inputHash);
        expect((await f.read()).inputHash).toBe(changed.inputHash);
        expect(changed.lock).toEqual(absent.lock);
        const file = key(path.join(f.root, 'npm-shrinkwrap.json'));
        f.files.delete(file);
        f.stats.delete(file);
        expect((await f.read()).inputHash).toBe(absent.inputHash);
      },
    );
    it.each(['linked', 'escaping', 'oversized', 'unreadable'] as const)(
      'retains %s ignored shrinkwrap warnings and the selected package-lock',
      async (failure) => {
        const f = npm12();
        f.put('package-lock.json', fixtureText('npm12/package-lock.json'));
        f.put('npm-shrinkwrap.json', '{}');
        const file = key(path.join(f.root, 'npm-shrinkwrap.json'));
        if (failure === 'linked')
          f.stats.set(file, stat(2, { isSymbolicLink: () => true }));
        if (failure === 'escaping')
          f.realpaths.set(file, 'D:\\TEST\\outside\\shrinkwrap');
        if (failure === 'oversized')
          f.stats.set(file, stat(32 * 1024 * 1024 + 1));
        if (failure === 'unreadable') {
          const original = f.lstat.getMockImplementation()!;
          f.lstat.mockImplementation((value) =>
            key(value) === file
              ? Promise.reject(errno('EACCES'))
              : original(value),
          );
        }
        const input = await f.read();
        expect(input.lock?.name).toBe('package-lock.json');
        expect(input.warningCodes).toEqual([
          failure === 'oversized' ? 'LIMIT_EXCEEDED' : 'UNREADABLE_INPUT',
        ]);
      },
    );
    it('rejects replacement during an ignored shrinkwrap read', async () => {
      const f = npm12();
      f.put('package-lock.json', fixtureText('npm12/package-lock.json'));
      f.put('npm-shrinkwrap.json', '{}');
      const original = f.readChunks.getMockImplementation()!;
      f.readChunks.mockImplementation(async function* (file, signal) {
        yield* original(file, signal);
        if (path.basename(file) === 'npm-shrinkwrap.json')
          f.stats.set(key(file), stat(2, { ino: 99 }));
      });
      await expect(f.read()).rejects.toMatchObject({
        details: { reason: 'INPUT_CHANGED' },
      });
    });
    it.each([
      [null, 'ambiguous', null, ['LOCKFILE_MISMATCH']],
      ['npm@11.17.0', 'npm', 'npm-shrinkwrap.json', []],
      ['npm@13.0.0', 'npm', 'npm-shrinkwrap.json', []],
      ['npm@12.2.2-pre.0', 'npm', 'npm-shrinkwrap.json', []],
      [
        'npm@12',
        'ambiguous',
        null,
        ['LOCKFILE_MISMATCH', 'UNSUPPORTED_MANAGER'],
      ],
      ['pnpm@11.0.0', 'pnpm', 'pnpm-lock.yaml', []],
      ['yarn@1.22.22', 'yarn', 'yarn.lock', []],
    ] as const)(
      'preserves mixed-lock selection for pin %s',
      async (packageManager, manager, name, warnings) => {
        const f = fixture();
        f.put('package.json', JSON.stringify({ packageManager }));
        f.put('npm-shrinkwrap.json', '{}');
        f.put('package-lock.json', '{}');
        f.put('pnpm-lock.yaml', '# TEST');
        f.put('yarn.lock', '# TEST');
        const input = await f.read();
        expect(input.manager).toBe(manager);
        expect(input.lock?.name ?? null).toBe(name);
        expect(input.warningCodes).toEqual(warnings);
      },
    );
    it.each([null, 'npm@11.17.0'])(
      'preserves selected-only lock hashing for pin %s',
      async (packageManager) => {
        const f = fixture();
        f.put('package.json', JSON.stringify({ packageManager }));
        f.put('npm-shrinkwrap.json', '{}');
        f.put('package-lock.json', '{"TEST":"first"}');
        const first = await f.read();
        f.put('package-lock.json', '{"TEST":"other"}');
        expect((await f.read()).inputHash).toBe(first.inputHash);
      },
    );
  });
  it('never changes managers to accommodate an inconsistent pin and lock', async () => {
    const f = fixture();
    f.put('package.json', '{"packageManager":"npm@11.0.0"}');
    f.put('pnpm-lock.yaml', '# TEST');
    const input = await f.read();
    expect(input.manager).toBe('npm');
    expect(input.lock).toBeNull();
    expect(input.warningCodes).toContain('LOCKFILE_MISMATCH');
  });
  it.each([
    'bun@1.0.0',
    'pnpm@',
    'pnpm@$(TEST)',
    '../TEST.cmd',
    'yarn@https://TEST.invalid/tool.js',
  ])(
    'keeps invalid/unsupported manager metadata inert: %s',
    async (packageManager) => {
      const f = fixture();
      f.put('package.json', JSON.stringify({ packageManager }));
      const input = await f.read();
      expect(input.manifest.packageManager).toBe(packageManager);
      expect(input.warningCodes).toContain('UNSUPPORTED_MANAGER');
    },
  );
  it('retains full dependency input above the 2,000-row presentation cap and warns', async () => {
    const f = fixture();
    f.put(
      'package.json',
      JSON.stringify({
        dependencies: Object.fromEntries(
          Array.from({ length: 2001 }, (_, index) => [`p${index}`, '^1.0.0']),
        ),
      }),
    );
    const input = await f.read();
    expect(input.manifest.dependencies).toHaveLength(2001);
    expect(input.warningCodes).toContain('LIMIT_EXCEEDED');
  });
  it('includes canonical project identity in hash even for byte-identical projects', async () => {
    const f = fixture();
    const first = await f.read();
    const secondRoot = 'D:\\TEST\\second';
    for (const [file, bytes] of [...f.files]) {
      const destination = key(path.join(secondRoot, path.basename(file)));
      f.files.set(destination, bytes);
      f.stats.set(destination, stat(bytes.length));
    }
    f.scan.projects[0].path = secondRoot;
    expect((await f.read(secondRoot)).inputHash).not.toBe(first.inputHash);
  });
  it('reads no more than four files concurrently', async () => {
    const f = fixture();
    for (const name of [
      '.npmrc',
      '.yarnrc',
      '.yarnrc.yml',
      'pnpm-workspace.yaml',
    ])
      f.put(name, '# TEST');
    const original = f.readChunks.getMockImplementation()!;
    let active = 0;
    let peak = 0;
    f.readChunks.mockImplementation(async function* (file, signal) {
      active++;
      peak = Math.max(peak, active);
      try {
        await tick();
        yield* original(file, signal);
      } finally {
        active--;
      }
    });
    await f.read();
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(4);
    expect(active).toBe(0);
  });
  it('honors pre-abort without starting file reads', async () => {
    const f = fixture();
    f.controller.abort();
    await expect(f.read()).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.readChunks).not.toHaveBeenCalled();
  });
  it('rejects a late read after abort rather than publishing captured bytes', async () => {
    const f = fixture();
    f.readChunks.mockImplementation(async function* () {
      await tick();
      f.controller.abort();
      yield Buffer.from('{}');
    });
    await expect(f.read()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
