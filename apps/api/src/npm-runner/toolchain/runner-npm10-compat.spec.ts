import { createHash } from 'node:crypto';
import { resolve, win32 as path } from 'node:path';
import { readNpm10InstallCompat } from './runner-npm10-compat';
import { fileStat, fsFixture, key } from '../__fixtures__/runner-test.fixture';

const source = `const isGlobalInstall = this.npm.global
const where = isGlobalInstall ? globalTop : this.npm.prefix
if (where === globalTop && !args.length) {}
if (where === globalTop && !args.every(Boolean)) {}
if (!args.length && !isGlobalInstall && !ignoreScripts) {}`;
const loader = `static cmd (c) {
    const command = deref(c)
    if (!command) {
      throw Object.assign(new Error(\`Unknown command \${c}\`), {
        code: 'EUNKNOWNCOMMAND',
        command: c,
      })
    }
    return require(\`./commands/\${command}.js\`)
  }`;
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('npm10 compatibility snapshot (mocked filesystem)', () => {
  const setup = () => {
    const f = fsFixture();
    const tool = f.installTool('npm', '10.9.9');
    const assets = {
      preload: resolve(__dirname, '../execution/npm10-install-preload.js'),
      source: path.join(tool.packageDir, 'lib/commands/install.js'),
      loader: path.join(tool.packageDir, 'lib/npm.js'),
    };
    f.put(assets.preload, '// TEST standalone preload');
    f.put(assets.source, source);
    f.put(assets.loader, loader);
    const read = () => readNpm10InstallCompat(tool, f.fs, f.controller.signal);
    return { ...f, tool, assets, read };
  };
  it('captures canonical assets and full byte hashes without executing npm', async () => {
    const f = setup();
    const result = await f.read();
    expect(result.compat).toEqual({
      revision: 1,
      supported: true,
      ...f.assets,
      sourceSha256: digest(source),
      loaderSha256: digest(loader),
      preloadSha256: digest('// TEST standalone preload'),
    });
    expect(result.identities.map((row) => key(row.path))).toEqual(
      expect.arrayContaining(Object.values(f.assets).map(key)),
    );
  });
  it.each(['preload', 'source', 'loader'] as const)(
    'softly refuses missing %s and fingerprints recovery',
    async (asset) => {
      const f = setup();
      f.remove(f.assets[asset]);
      const first = await f.read();
      expect(first.compat).toMatchObject({ revision: 1, supported: false });
      expect((await f.read()).compat).toEqual(first.compat);
      f.put(f.assets[asset], 'TEST different unsupported bytes');
      expect((await f.read()).compat).not.toEqual(first.compat);
    },
  );
  it.each(['preload', 'source', 'loader'] as const)(
    'softly refuses unreadable, oversize and malformed UTF8 %s',
    async (asset) => {
      const f = setup();
      const file = f.assets[asset];
      const normalOpen = f.open.getMockImplementation()!;
      f.open.mockImplementation((requested) =>
        key(requested) === key(file)
          ? Promise.reject(Object.assign(new Error('TEST'), { code: 'EACCES' }))
          : normalOpen(requested),
      );
      expect((await f.read()).compat.supported).toBe(false);
      f.open.mockImplementation(normalOpen);
      f.stats.set(key(file), fileStat(1024 * 1024 + 1));
      expect((await f.read()).compat.supported).toBe(false);
      f.stats.set(key(file), fileStat(1));
      f.files.set(key(file), Buffer.from([0xff]));
      expect((await f.read()).compat.supported).toBe(false);
    },
  );
  it.each([
    source.replace('if (where === globalTop && !args.length)', 'if (true)'),
    source + '\nif (where === globalTop && !args.length) {}',
    source.replace('this.npm.global', 'true'),
    source.replace('!ignoreScripts', 'false'),
  ])('refuses unknown or ambiguous install source', async (bad) => {
    const f = setup();
    f.put(f.assets.source, bad);
    expect((await f.read()).compat.supported).toBe(false);
  });
  it('refuses a modified dispatch seam and redirected ancestor', async () => {
    const f = setup();
    f.put(f.assets.loader, loader.replace('deref(c)', 'c'));
    expect((await f.read()).compat.supported).toBe(false);
    f.put(f.assets.loader, loader);
    f.realpaths.set(key(path.dirname(f.assets.source)), 'E:\\TEST\\redirect');
    expect((await f.read()).compat.supported).toBe(false);
  });
  it('retains available digests in unsupported snapshots', async () => {
    const f = setup();
    f.remove(f.assets.preload);
    const before = await f.read();
    f.put(f.assets.source, source + '\n// TEST byte drift');
    expect((await f.read()).compat).not.toEqual(before.compat);
  });
  it('propagates cancellation, including cancellation during a failed read', async () => {
    const f = setup();
    f.onEvent((event) => {
      if (event.startsWith('read:')) f.controller.abort();
    });
    await expect(f.read()).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('softly records non-Error filesystem failures', async () => {
    const f = setup();
    f.open.mockRejectedValueOnce(null);
    expect((await f.read()).compat.supported).toBe(false);
  });
  it('propagates an IO AbortError without converting it to unsupported', async () => {
    const f = setup();
    const abort = new DOMException('TEST cancelled IO', 'AbortError');
    f.open.mockRejectedValueOnce(abort);
    await expect(f.read()).rejects.toBe(abort);
  });
});
