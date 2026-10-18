import { toComparable } from '@/common/utils/path.util';
import {
  buildDenylist,
  findDenyMatch,
  isInsideProtectedTree,
} from '@/core/path-guard/denylist';

const winDenylist = buildDenylist({
  platform: 'win32',
  env: {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramData: 'C:\\ProgramData',
    ProgramW6432: 'relative\\ignored',
  },
  homeDir: 'C:\\Users\\alice',
  appInstallDir: 'D:\\Tools\\PkgSteward\\pkgsteward_be',
  sourceCheckoutDir: 'D:\\Tools\\PkgSteward',
  dataDir: 'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
});
const deny = (p: string) =>
  findDenyMatch(toComparable(p, 'win32'), winDenylist, 'win32');

describe('buildDenylist', () => {
  it('skips missing or relative environment values', () =>
    expect(winDenylist.some((e) => e.path.includes('relative'))).toBe(false));
});

describe('Windows system environment', () => {
  const buildWithEnv = (env: Record<string, string | undefined>) =>
    buildDenylist({
      platform: 'win32',
      env,
      homeDir: 'C:\\Users\\alice',
      appInstallDir: 'D:\\Tools\\PkgSteward\\pkgsteward_be',
      sourceCheckoutDir: 'D:\\Tools\\PkgSteward',
      dataDir: 'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
    });

  it.each([
    ['SystemRoot', 'E:\\CustomOS', 'E:\\'],
    ['windir', 'E:\\CustomLayout\\WinDir', 'E:\\CustomLayout'],
    ['ProgramFiles', 'E:\\CustomLayout\\Apps', 'E:\\CustomLayout'],
    ['ProgramFiles(x86)', 'E:\\CustomLayout\\Apps32', 'E:\\CustomLayout'],
    ['ProgramW6432', 'E:\\CustomLayout\\Apps64', 'E:\\CustomLayout'],
    ['ProgramData', 'E:\\CustomLayout\\SharedData', 'E:\\CustomLayout'],
  ])(
    'protects the custom %s subtree without pruning its ancestors',
    (key, folder, parent) => {
      const entries = buildWithEnv({ [key]: folder });
      const reason = `system folder %${key}%`;
      for (const target of [folder, `${folder}\\child`]) {
        const comparable = toComparable(target, 'win32');
        expect(findDenyMatch(comparable, entries, 'win32')).toBe(reason);
        expect(isInsideProtectedTree(comparable, entries, 'win32')).toBe(true);
      }
      expect(
        isInsideProtectedTree(toComparable(parent, 'win32'), entries, 'win32'),
      ).toBe(false);
      expect(isInsideProtectedTree('e:\\', entries, 'win32')).toBe(false);
    },
  );

  it.each([
    { label: 'missing', env: {} },
    {
      label: 'empty',
      env: {
        SystemRoot: '',
        windir: '',
        ProgramFiles: '',
        'ProgramFiles(x86)': '',
        ProgramW6432: '',
        ProgramData: '',
      },
    },
    {
      label: 'undefined',
      env: {
        SystemRoot: undefined,
        windir: undefined,
        ProgramFiles: undefined,
        'ProgramFiles(x86)': undefined,
        ProgramW6432: undefined,
        ProgramData: undefined,
      },
    },
  ])(
    'ignores $label env values and keeps hardcoded system protection',
    ({ env }) => {
      const entries = buildWithEnv(env);
      expect(entries.map((entry) => entry.path)).toEqual([
        'c:\\users\\alice',
        'c:\\users',
        'd:\\tools\\pkgsteward\\pkgsteward_be',
        'd:\\tools\\pkgsteward',
        'c:\\users\\alice\\appdata\\local\\pkgsteward',
      ]);
      for (const folder of [
        'E:\\Windows',
        'E:\\Program Files',
        'E:\\Program Files (x86)',
        'E:\\ProgramData',
        'E:\\$Recycle.Bin',
        'E:\\System Volume Information',
        'E:\\Recovery',
      ]) {
        for (const target of [folder, `${folder}\\child`]) {
          const comparable = toComparable(target, 'win32');
          expect(findDenyMatch(comparable, entries, 'win32')).not.toBeNull();
          expect(isInsideProtectedTree(comparable, entries, 'win32')).toBe(
            true,
          );
        }
      }
      expect(findDenyMatch('e:\\unrelated', entries, 'win32')).toBeNull();
      expect(isInsideProtectedTree('e:\\unrelated', entries, 'win32')).toBe(
        false,
      );
    },
  );
});

describe('findDenyMatch (win32)', () => {
  it.each(['C:\\', 'd:\\'])('blocks the drive root %s', (p) =>
    expect(deny(p)).toMatch(/drive root/),
  );
  it.each([
    'C:\\Windows\\System32',
    'c:\\PROGRAM FILES\\nodejs',
    'C:\\Program Files (x86)\\Foo',
    'C:\\ProgramData\\npm',
    'E:\\Program Files (x86)\\x',
    'D:\\$Recycle.Bin\\S-1-5',
    'D:\\System Volume Information',
    'C:\\Recovery\\x',
  ])('blocks system folder %s and its contents', (p) =>
    expect(deny(p)).not.toBeNull(),
  );
  it.each(['C:\\Users', 'E:\\Users', 'C:\\Users\\alice'])(
    'blocks %s itself',
    (p) => expect(deny(p)).not.toBeNull(),
  );
  it.each([
    'C:\\Users\\alice\\Projects\\app',
    'C:\\Users\\alice\\AppData\\Roaming\\npm',
    'C:\\Users\\bob\\code',
    'D:\\Tools\\other',
  ])('allows %s', (p) => expect(deny(p)).toBeNull());
  it.each([
    'D:\\Tools\\PkgSteward\\pkgsteward_be\\src',
    'D:\\Tools\\PkgSteward\\pkgsteward_fe',
    'C:\\Users\\alice\\AppData\\Local\\PkgSteward\\logs',
  ])('blocks PkgSteward folders and their contents: %s', (p) =>
    expect(deny(p)).not.toBeNull(),
  );
  it.each([
    'D:\\Tools',
    'C:\\Users\\alice\\AppData',
    'C:\\Users\\alice\\AppData\\Local',
  ])('blocks %s because it contains a protected folder', (p) =>
    expect(deny(p)).toMatch(/parent of/),
  );
});

describe('isInsideProtectedTree (Scanner pruning)', () => {
  const inside = (p: string) =>
    isInsideProtectedTree(toComparable(p, 'win32'), winDenylist, 'win32');
  it.each([
    'C:\\Windows',
    'C:\\Windows\\System32',
    'E:\\Program Files\\x',
    'D:\\Tools\\PkgSteward\\pkgsteward_be',
    'C:\\Users\\alice\\AppData\\Local\\PkgSteward\\cache',
  ])('prunes %s', (p) => expect(inside(p)).toBe(true));
  it.each(['C:\\', 'C:\\Users', 'C:\\Users\\alice', 'D:\\Tools', 'D:\\Scan'])(
    'still walks into %s',
    (p) => expect(inside(p)).toBe(false),
  );
});

describe('POSIX (CI only)', () => {
  const posix = buildDenylist({
    platform: 'posix',
    env: {},
    homeDir: '/home/alice',
    appInstallDir: '/opt/pkgsteward/pkgsteward_be',
    sourceCheckoutDir: null,
    dataDir: '/home/alice/.local/share/PkgSteward',
  });
  const denyPosix = (p: string) =>
    findDenyMatch(toComparable(p, 'posix'), posix, 'posix');
  it('blocks /, /home and the home folder itself', () => {
    expect(denyPosix('/')).not.toBeNull();
    expect(denyPosix('/home')).not.toBeNull();
    expect(denyPosix('/home/alice')).not.toBeNull();
  });
  it('allows folders inside home and is case-sensitive', () => {
    expect(denyPosix('/home/alice/code')).toBeNull();
    expect(denyPosix('/opt/PkgSteward/pkgsteward_be')).toBeNull();
    expect(denyPosix('/opt/pkgsteward/pkgsteward_be/src')).not.toBeNull();
  });
});
