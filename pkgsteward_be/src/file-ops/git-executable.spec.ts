import { resolveGitExecutable } from '@/file-ops/git-executable';

const filesAt = (...existing: string[]) => {
  const isFile = jest.fn((path: string) =>
    Promise.resolve(existing.includes(path)),
  );
  return isFile;
};

describe('resolveGitExecutable', () => {
  it('returns the first git.exe found in absolute PATH entries on Windows', async () => {
    const isFile = filesAt(
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'D:\\Other\\git.exe',
    );

    await expect(
      resolveGitExecutable(
        'C:\\Tools;C:\\Program Files\\Git\\cmd;D:\\Other',
        'win32',
        isFile,
      ),
    ).resolves.toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(isFile.mock.calls.map(([path]) => path)).toEqual([
      'C:\\Tools\\git.exe',
      'C:\\Program Files\\Git\\cmd\\git.exe',
    ]);
  });

  // A relative entry resolves against the spawn cwd, which is an untrusted project folder.
  it('never checks relative, drive-relative, rooted or empty PATH entries', async () => {
    const isFile = filesAt();

    await expect(
      resolveGitExecutable(
        '.;bin;C:tools;\\tools;;\\\\server\\share\\git',
        'win32',
        isFile,
      ),
    ).resolves.toBeNull();
    expect(isFile).not.toHaveBeenCalled();
  });

  it('accepts a quoted PATH entry', async () => {
    const isFile = filesAt('C:\\Program Files\\Git\\cmd\\git.exe');

    await expect(
      resolveGitExecutable('"C:\\Program Files\\Git\\cmd"', 'win32', isFile),
    ).resolves.toBe('C:\\Program Files\\Git\\cmd\\git.exe');
  });

  // Only .exe is spawned directly; any other extension would go through cmd.exe.
  it('ignores git scripts that are not git.exe on Windows', async () => {
    const isFile = jest.fn((path: string) =>
      Promise.resolve(!path.toLowerCase().endsWith('git.exe')),
    );

    await expect(
      resolveGitExecutable('C:\\Tools', 'win32', isFile),
    ).resolves.toBeNull();
    expect(isFile).toHaveBeenCalledTimes(1);
    expect(isFile).toHaveBeenCalledWith('C:\\Tools\\git.exe');
  });

  it('searches colon-separated absolute entries on POSIX', async () => {
    const isFile = filesAt('/usr/bin/git');

    await expect(
      resolveGitExecutable('relative:/usr/local/bin:/usr/bin', 'posix', isFile),
    ).resolves.toBe('/usr/bin/git');
    expect(isFile.mock.calls.map(([path]) => path)).toEqual([
      '/usr/local/bin/git',
      '/usr/bin/git',
    ]);
  });

  it.each([undefined, ''])('returns null when PATH is %p', async (value) => {
    await expect(
      resolveGitExecutable(value, 'win32', filesAt()),
    ).resolves.toBeNull();
  });
});
