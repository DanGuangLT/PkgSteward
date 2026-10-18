import { parseScanRootPaths } from '@/config/scan-roots';

describe('parseScanRootPaths', () => {
  it.each([undefined, '', '   ', ' , '])(
    'treats %p as every fixed drive',
    (v) =>
      expect(parseScanRootPaths(v, 'win32')).toEqual({
        kind: 'all-fixed-drives',
      }),
  );
  it('accepts "*" alone', () =>
    expect(parseScanRootPaths(' * ', 'win32')).toEqual({
      kind: 'all-fixed-drives',
    }));
  it.each(['*,D:\\x', 'D:\\x,*', 'D:\\x*'])(
    'rejects %s ("*" must be alone)',
    (v) =>
      expect(() => parseScanRootPaths(v, 'win32')).toThrow(
        /must be used alone/,
      ),
  );
  it('returns resolved absolute paths', () =>
    expect(parseScanRootPaths('D:\\a\\, E:/b', 'win32')).toEqual({
      kind: 'paths',
      paths: ['D:\\a', 'E:\\b'],
    }));
  it.each(['projects', 'C:foo', '\\\\server\\share'])(
    'rejects %s on Windows',
    (v) => expect(() => parseScanRootPaths(v, 'win32')).toThrow(/absolute/),
  );
  it('uses POSIX rules off Windows', () => {
    expect(parseScanRootPaths('/tmp/a', 'posix')).toEqual({
      kind: 'paths',
      paths: ['/tmp/a'],
    });
    expect(() => parseScanRootPaths('D:\\a', 'posix')).toThrow(/absolute/);
  });
});
