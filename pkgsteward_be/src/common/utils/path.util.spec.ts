import { isFullyQualifiedPath, toPathPlatform } from '@/common/utils/path.util';

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
