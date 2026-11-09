import * as fs from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { walkScan } from '@/scanner/discovery/scan-walker';

// Read-only Windows fixture prepared externally:
// <base>/scanner/allowed/app/package.json
// <base>/scanner/allowed/escape -> junction to <base>/scanner/outside
// <base>/scanner/outside/package.json
const baseDir = process.env.PKGSTEWARD_REAL_FS_TEST_DIR;
const describeReal =
  process.platform === 'win32' && baseDir ? describe : describe.skip;

describeReal('Scan walker on the real Windows filesystem', () => {
  const allowedRoot = () => join(baseDir as string, 'scanner', 'allowed');
  const scan = async () => {
    const readdir = jest.fn((directory: string) =>
      fs.readdir(directory, { withFileTypes: true }),
    );
    const onSkipped = jest.fn();
    const snapshot = await walkScan(
      [allowedRoot()],
      0,
      new AbortController().signal,
      {
        platform: 'win32',
        fs: {
          readdir,
          lstat: (file) => fs.lstat(file),
          realpath: (file) => fs.realpath(file),
          readFile: (file, signal) =>
            fs.readFile(file, { encoding: 'utf8', signal }),
        },
        isInsideProtectedTree: () => Promise.resolve(false),
        onProgress: () => undefined,
        onSkipped,
      },
    );
    expect(onSkipped).not.toHaveBeenCalled();
    expect(snapshot.progress.skippedCount).toBe(0);
    return { snapshot, readdir };
  };

  it('never enters a junction or publishes the outside project', async () => {
    const entries = await fs.readdir(allowedRoot(), { withFileTypes: true });
    expect(
      entries.find((entry) => entry.name === 'escape')?.isSymbolicLink(),
    ).toBe(true);
    const outside = await fs.realpath(
      join(baseDir as string, 'scanner', 'outside'),
    );
    const escape = join(await fs.realpath(allowedRoot()), 'escape');
    const { snapshot, readdir } = await scan();
    const comparable = (value: string) => win32.normalize(value).toLowerCase();
    for (const [directory] of readdir.mock.calls) {
      expect(comparable(directory)).not.toBe(comparable(escape));
      expect(comparable(directory).startsWith(`${comparable(escape)}\\`)).toBe(
        false,
      );
      expect(comparable(directory)).not.toBe(comparable(outside));
      expect(comparable(directory).startsWith(`${comparable(outside)}\\`)).toBe(
        false,
      );
    }
    expect(
      snapshot.projects.some(
        (project) => comparable(project.path) === comparable(outside),
      ),
    ).toBe(false);
  });

  it('still traverses and discovers the ordinary project child', async () => {
    const appPath = await fs.realpath(join(allowedRoot(), 'app'));
    const { snapshot, readdir } = await scan();
    expect(readdir).toHaveBeenCalledWith(appPath);
    expect(snapshot.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: appPath,
          nodeModules: expect.objectContaining({ sizeBytes: null }) as unknown,
        }),
      ]),
    );
    expect(snapshot.progress.foundProjects).toBeGreaterThanOrEqual(1);
  });
});
