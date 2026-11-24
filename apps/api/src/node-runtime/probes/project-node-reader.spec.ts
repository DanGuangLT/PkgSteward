import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Stats } from 'node:fs';
import {
  readProjectNodeConfig,
  readProjectNodeRequirements,
  type IProjectNodeFsDeps,
} from '@/node-runtime/probes/project-node-reader';

function makeStat(opts: {
  isFile?: boolean;
  isSymbolicLink?: boolean;
  size?: number;
}): Stats {
  return {
    isFile: () => opts.isFile ?? true,
    isSymbolicLink: () => opts.isSymbolicLink ?? false,
    size: opts.size ?? 16,
  } as unknown as Stats;
}

describe('project-node-reader', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads .nvmrc, .node-version, and package.json#engines.node in precedence order from real files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkgsteward-node-reader-'));
    tempDirs.push(dir);
    writeFileSync(join(dir, '.nvmrc'), 'v20.18.1 # pinned\n', 'utf8');
    writeFileSync(join(dir, '.node-version'), '22.18.0\n', 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'sample-app',
        engines: { node: '>=22.18.0' },
      }),
      'utf8',
    );

    const config = await readProjectNodeConfig(dir);

    expect(config.packageName).toBe('sample-app');
    expect(config.requirements).toEqual([
      {
        source: '.nvmrc',
        raw: 'v20.18.1 # pinned',
        normalizedRange: '20.18.1',
        suggestedVersion: '20.18.1',
      },
      {
        source: '.node-version',
        raw: '22.18.0',
        normalizedRange: '22.18.0',
        suggestedVersion: '22.18.0',
      },
      {
        source: 'package.json#engines.node',
        raw: '>=22.18.0',
        normalizedRange: '>=22.18.0',
        suggestedVersion: '22.18.0',
      },
    ]);
  });

  it('ignores missing files and invalid package.json cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkgsteward-node-reader-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'package.json'), '{not-valid-json', 'utf8');

    const requirements = await readProjectNodeRequirements(join(dir, 'sub'));
    expect(requirements).toEqual([]);
  });

  it('skips symlinked config files without reading them', async () => {
    const readPaths: string[] = [];
    const root = 'D:\\Projects\\app';
    const deps: IProjectNodeFsDeps = {
      lstat: (filePath) => {
        if (filePath.endsWith('.nvmrc')) {
          return Promise.resolve(
            makeStat({ isFile: false, isSymbolicLink: true }),
          );
        }
        if (filePath.endsWith('.node-version')) {
          return Promise.resolve(
            makeStat({ isFile: true, isSymbolicLink: false }),
          );
        }
        return Promise.reject(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
      },
      realpath: (filePath) => Promise.resolve(filePath),
      readFile: (filePath) => {
        readPaths.push(filePath);
        return Promise.resolve('22.18.0\n');
      },
    };

    const requirements = await readProjectNodeRequirements(root, deps);

    expect(readPaths).toEqual([join(root, '.node-version')]);
    expect(requirements).toEqual([
      {
        source: '.node-version',
        raw: '22.18.0',
        normalizedRange: '22.18.0',
        suggestedVersion: '22.18.0',
      },
    ]);
  });

  it('rejects files whose realpath escapes projectDirReal', async () => {
    const readPaths: string[] = [];
    const root = 'D:\\Projects\\app';
    const deps: IProjectNodeFsDeps = {
      lstat: () =>
        Promise.resolve(makeStat({ isFile: true, isSymbolicLink: false })),
      realpath: (filePath) => {
        if (filePath.endsWith('.nvmrc')) {
          return Promise.resolve('C:\\Windows\\System32\\secret.txt');
        }
        return Promise.resolve(filePath);
      },
      readFile: (filePath) => {
        readPaths.push(filePath);
        if (filePath.endsWith('package.json')) {
          return Promise.resolve(
            JSON.stringify({ name: 'ok', engines: { node: '>=22.18' } }),
          );
        }
        return Promise.resolve('20.0.0');
      },
    };

    const config = await readProjectNodeConfig(root, deps);

    expect(readPaths).not.toContain(join(root, '.nvmrc'));
    expect(config.requirements.map((item) => item.source)).toEqual([
      '.node-version',
      'package.json#engines.node',
    ]);
  });

  it('enforces byte caps before reading oversized config files', async () => {
    const readPaths: string[] = [];
    const root = 'D:\\Projects\\app';
    const deps: IProjectNodeFsDeps = {
      lstat: (filePath) => {
        if (filePath.endsWith('.nvmrc')) {
          return Promise.resolve(makeStat({ size: 2048 }));
        }
        if (filePath.endsWith('package.json')) {
          return Promise.resolve(makeStat({ size: 3 * 1024 * 1024 }));
        }
        return Promise.reject(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
        );
      },
      realpath: (filePath) => Promise.resolve(filePath),
      readFile: (filePath) => {
        readPaths.push(filePath);
        return Promise.resolve('20.0.0');
      },
    };

    const requirements = await readProjectNodeRequirements(root, deps);

    expect(readPaths).toEqual([]);
    expect(requirements).toEqual([]);
  });
});
