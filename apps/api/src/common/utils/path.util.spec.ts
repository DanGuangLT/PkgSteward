import {
  hasTraversalSegment,
  isFullyQualifiedPath,
  isSameOrInside,
  toComparable,
  toPathPlatform,
} from '@/common/utils/path.util';

describe('isFullyQualifiedPath', () => {
  it.each(['C:\\', 'D:\\Coding', 'd:/coding/app'])('win32 accepts %s', (p) =>
    expect(isFullyQualifiedPath(p, 'win32')).toBe(true),
  );
  it.each([
    'projects',
    'C:foo',
    '\\Windows',
    '\\\\server\\share',
    '\\\\?\\C:\\Windows',
    '/home/a',
    '',
  ])('win32 rejects %s', (p) =>
    expect(isFullyQualifiedPath(p, 'win32')).toBe(false),
  );
  it('posix accepts only paths starting with /', () => {
    expect(isFullyQualifiedPath('/home/a', 'posix')).toBe(true);
    expect(isFullyQualifiedPath('home/a', 'posix')).toBe(false);
    expect(isFullyQualifiedPath('D:\\a', 'posix')).toBe(false);
  });
  it('toPathPlatform maps win32 and everything else', () => {
    expect(toPathPlatform('win32')).toBe('win32');
    expect(toPathPlatform('linux')).toBe('posix');
  });
});

describe('hasTraversalSegment', () => {
  it.each(['D:\\a\\..\\b', 'D:/a/../b', '..\\x'])('flags %s', (p) =>
    expect(hasTraversalSegment(p)).toBe(true),
  );
  it.each(['D:\\a\\..b', 'D:\\a\\b..', 'D:\\a\\.\\b'])('allows %s', (p) =>
    expect(hasTraversalSegment(p)).toBe(false),
  );
});

describe('toComparable', () => {
  it('lower-cases and normalises Windows paths', () => {
    expect(toComparable('D:/Scan/App/', 'win32')).toBe('d:\\scan\\app');
    expect(toComparable('D:\\', 'win32')).toBe('d:\\');
  });
  it('keeps case on POSIX', () =>
    expect(toComparable('/Home/A/', 'posix')).toBe('/Home/A'));
});

describe('isSameOrInside', () => {
  it('matches the same folder and its children', () => {
    expect(isSameOrInside('d:\\a', 'd:\\a', 'win32')).toBe(true);
    expect(isSameOrInside('d:\\a\\b', 'd:\\a', 'win32')).toBe(true);
    expect(isSameOrInside('c:\\x', 'c:\\', 'win32')).toBe(true);
  });
  it('does not treat a sibling with a common prefix as inside', () =>
    expect(isSameOrInside('d:\\ab', 'd:\\a', 'win32')).toBe(false));
});
