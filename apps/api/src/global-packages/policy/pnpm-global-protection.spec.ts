import 'reflect-metadata';
import { win32 } from 'node:path';
import { AppException } from '@/common/exceptions/app.exception';
import { assertGlobalPackageMutable } from '@/global-packages/policy/global-policy';
import type { IGlobalProtectionInput } from '@/global-packages/interfaces/global-packages.runtime';
import { pnpmPreviewFacts } from '@/global-packages/__fixtures__/pnpm11/inventory';
import {
  TEST_PATHS,
  testLocation,
} from '@/global-packages/__fixtures__/global-adapters';

// TEST không phải yêu cầu nghiệp vụ. Paths/facts only; no filesystem or process IO.
function protection(): IGlobalProtectionInput {
  const facts = pnpmPreviewFacts();
  return {
    packageName: facts.current.name,
    packageRoot: facts.current.packageRoot,
    linked: false,
    currentBins: [],
    targetBins: [],
    binOwners: [],
    ownershipComplete: true,
    protectedPaths: testLocation().protectedPaths,
    pnpmGroup: facts.current.pnpmGroup,
    groupPackages: [facts.current],
  };
}

function refused(
  input: IGlobalProtectionInput,
  reason = 'PROTECTED_PACKAGE',
): void {
  let caught: unknown;
  try {
    assertGlobalPackageMutable(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppException);
  expect((caught as AppException).details).toMatchObject({ reason });
}

describe('pnpm 11 mutation protection', () => {
  it.each(['npm', 'pnpm'] as const)(
    'protects @pnpm/exe hosted by %s',
    (manager) => {
      const location = testLocation(manager);
      refused({
        ...protection(),
        packageName: '@pnpm/exe',
        packageRoot: win32.join(location.globalRoot, '@pnpm', 'exe'),
        pnpmGroup: undefined,
        groupPackages: undefined,
      });
    },
  );

  it.each(['logical', 'real', 'install'] as const)(
    'checks %s roots against Node, distributions, app, source and data',
    (kind) => {
      for (const protectedPath of testLocation().protectedPaths) {
        for (const suffix of ['', '\\child']) {
          const input = protection();
          const root = `${protectedPath}${suffix}`;
          if (kind === 'logical')
            input.pnpmGroup!.packageLinks[0].logicalPath = root;
          if (kind === 'real') {
            input.packageRoot = root;
            input.pnpmGroup!.packageLinks[0].realPath = root;
            input.groupPackages![0].packageRoot = root;
          }
          if (kind === 'install') input.pnpmGroup!.installDir = root;
          refused(input);
        }
      }
    },
  );

  it.each(['logical', 'real', 'install'] as const)(
    'refuses a %s root containing a protected descendant',
    (kind) => {
      const input = protection();
      const root =
        kind === 'logical'
          ? input.pnpmGroup!.packageLinks[0].logicalPath
          : kind === 'real'
            ? input.packageRoot
            : input.pnpmGroup!.installDir;
      input.protectedPaths = [win32.join(root, 'PkgSteward', 'data')];
      refused(input);
    },
  );

  it.each(['npm', 'corepack', 'pnpm', 'yarn', '@pnpm/exe', 'pkgsteward'])(
    'refuses collateral removal of coinstalled protected package %s',
    (name) => {
      const input = protection();
      const sibling = pnpmPreviewFacts().current;
      sibling.name = name;
      sibling.packageRoot = win32.join(
        input.pnpmGroup!.installDir,
        'node_modules',
        name,
      );
      sibling.pnpmGroup = input.pnpmGroup;
      input.groupPackages = [...input.groupPackages!, sibling];
      input.pnpmGroup!.directDependencies = ['is-number', name];
      refused(input);
    },
  );

  it.each([
    'NODE.EXE',
    'npm.cmd',
    'PNPX.PS1',
    'yarnpkg',
    'corepack',
    'pkgsteward',
  ])('refuses collateral removal of protected group bin %s', (name) => {
    const input = protection();
    const sibling = pnpmPreviewFacts().current;
    sibling.name = 'test-sibling';
    sibling.bins = [{ name, target: 'bin/tool.js' }];
    sibling.pnpmGroup = input.pnpmGroup;
    input.groupPackages = [...input.groupPackages!, sibling];
    input.pnpmGroup!.directDependencies = ['is-number', sibling.name];
    refused(input);
  });

  it.each(['currentBins', 'targetBins'] as const)(
    'checks protected %s on a single-package pnpm install',
    (field) => {
      const input = protection();
      input[field] = [{ name: 'PNPM.CMD', target: 'bin/tool.js' }];
      refused(input);
    },
  );

  it('refuses incomplete ownership and foreign target bins', () => {
    refused({ ...protection(), ownershipComplete: false }, 'BIN_CONFLICT');
    refused(
      {
        ...protection(),
        targetBins: [{ name: 'test-tool', target: 'bin/tool.js' }],
        binOwners: [{ name: 'test-tool', owner: 'test-other' }],
      },
      'BIN_CONFLICT',
    );
  });

  it('does not apply the internal-link exception to an unproven external link', () => {
    refused({ ...protection(), linked: true }, 'LINKED_PACKAGE');
  });

  it('leaves an ordinary proven internal link mutable and preserves its facts', () => {
    const input = protection();
    const before = JSON.stringify(input);
    expect(() => assertGlobalPackageMutable(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not protect the whole npm prefix or the Node directory', () => {
    for (const root of [
      win32.join(TEST_PATHS.prefix, 'node_modules', 'typescript'),
      win32.join(win32.dirname(TEST_PATHS.node), 'node_modules', 'typescript'),
    ]) {
      const input = protection();
      input.packageRoot = root;
      input.pnpmGroup!.packageLinks[0].realPath = root;
      input.groupPackages![0].packageRoot = root;
      expect(() => assertGlobalPackageMutable(input)).not.toThrow();
    }
  });
});
