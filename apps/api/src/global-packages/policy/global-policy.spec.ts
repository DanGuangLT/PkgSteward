import { AppException } from '@/common/exceptions/app.exception';
import {
  assertGlobalPackageMutable,
  assessGlobalVersionChange,
  getGlobalRisk,
  globalConfirmText,
  GLOBAL_PROTECTED_BINS,
  GLOBAL_PROTECTED_PACKAGES,
  isGlobalPackageName,
  isGlobalTargetVersion,
  normalizeGlobalBins,
} from '@/global-packages/policy/global-policy';
import type { IGlobalProtectionInput } from '@/global-packages/interfaces/global-packages.runtime';
import { parseRunnerPackageSpec } from '@/npm-runner/execution/runner-command';
import { assessRisk } from '@/core/risk/risk';
import * as sharedRisk from '@/core/risk/risk';
import { validateConfirmation } from '@/core/risk/confirmation';

const protection = (
  patch: Partial<IGlobalProtectionInput> = {},
): IGlobalProtectionInput => ({
  packageName: '@test/tool',
  packageRoot: 'D:\\TEST\\global\\node_modules\\@test\\tool',
  linked: false,
  currentBins: [{ name: 'test-tool', target: 'bin/old.js' }],
  targetBins: [{ name: 'test-tool', target: 'bin/new.js' }],
  binOwners: [{ name: 'test-tool', owner: '@test/tool' }],
  ownershipComplete: true,
  protectedPaths: [
    'D:\\TEST\\node',
    'D:\\TEST\\app',
    'D:\\TEST\\source',
    'D:\\TEST\\data',
  ],
  ...patch,
});
const expectReason = (run: () => unknown, reason: string) => {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppException);
  expect((caught as AppException).details).toMatchObject({ reason });
};

describe('M6 registry grammar reuse', () => {
  it.each(['tool', '@test/tool', 'a-b.c_d'])(
    'shares the runner registry name grammar for %s',
    (name) => {
      expect(parseRunnerPackageSpec(name, false).name).toBe(name);
      expect(isGlobalPackageName(name)).toBe(true);
    },
  );
  it.each([
    'tool@1.2.3',
    'tool@latest',
    'npm:tool',
    'file:tool',
    '../tool',
    '--force',
    '@test/tool@npm:other',
    'https://test.invalid/a.tgz',
    'tool\n',
    'TOOL',
  ])('does not admit aliases, paths or options: %s', (name) => {
    expect(isGlobalPackageName(name)).toBe(false);
  });
  it.each(['1.2.3', '1.2.3-beta.1', 'latest', 'test-tag'])(
    'shares runner exact/tag grammar for %s',
    (target) => {
      expect(parseRunnerPackageSpec(`tool@${target}`, true).version).toBe(
        target,
      );
      expect(isGlobalTargetVersion(target)).toBe(true);
    },
  );
  it.each([
    undefined,
    null,
    1,
    '^1.0.0',
    '*',
    '>=1',
    '1.2',
    'v1.2.3',
    'latest ',
    'tool@latest',
  ])('rejects malformed or noncanonical target %p', (target) => {
    expect(isGlobalTargetVersion(target)).toBe(false);
  });
});

describe('declared bin normalization', () => {
  it('normalizes string bins using unscoped basename, and absent bins to empty', () => {
    expect(normalizeGlobalBins('@test/tool', 'bin/tool.js')).toEqual([
      { name: 'tool', target: 'bin/tool.js' },
    ]);
    expect(normalizeGlobalBins('tool', undefined)).toEqual([]);
  });
  it('normalizes object bins without mutating metadata', () => {
    const bins = Object.freeze({
      tool: './bin/tool.js',
      helper: 'dist/helper.js',
    });
    expect(normalizeGlobalBins('tool', bins)).toEqual([
      { name: 'helper', target: 'dist/helper.js' },
      { name: 'tool', target: 'bin/tool.js' },
    ]);
    expect(bins.tool).toBe('./bin/tool.js');
  });
  it.each([
    null,
    1,
    [],
    { tool: 1 },
    { tool: null },
    { tool: '' },
    { tool: '../escape.js' },
    { tool: 'bin/../../escape.js' },
    { tool: '/absolute.js' },
    { tool: 'D:\\escape.js' },
    { tool: '\\\\host\\share\\tool.js' },
    { tool: 'bin/tool.js\0' },
    { tool: 'bin\\..\\escape.js' },
    { '../tool': 'bin/tool.js' },
    { 'a/b': 'bin/tool.js' },
    { 'a\\b': 'bin/tool.js' },
    { 'tool\n': 'bin/tool.js' },
    { 'tool:stream': 'bin/tool.js' },
    { Tool: 'a.js', tool: 'b.js' },
  ])('refuses unsafe/malformed bin declaration %p', (bins) => {
    expectReason(() => normalizeGlobalBins('tool', bins), 'BIN_CONFLICT');
  });
});

describe('global protection, without confirmation override', () => {
  it.each(GLOBAL_PROTECTED_PACKAGES)(
    'protects tool package %s',
    (packageName) => {
      expectReason(
        () => assertGlobalPackageMutable(protection({ packageName })),
        'PROTECTED_PACKAGE',
      );
    },
  );
  it.each(GLOBAL_PROTECTED_BINS)(
    'protects current and target bin %s ignoring case',
    (name) => {
      const bin = { name: name.toUpperCase(), target: 'bin/tool.js' };
      expectReason(
        () =>
          assertGlobalPackageMutable(
            protection({ currentBins: [bin], targetBins: [] }),
          ),
        'PROTECTED_PACKAGE',
      );
      expectReason(
        () =>
          assertGlobalPackageMutable(
            protection({ currentBins: [], targetBins: [bin] }),
          ),
        'PROTECTED_PACKAGE',
      );
    },
  );
  it.each(['npm.cmd', 'NPM.PS1', 'node.exe'])(
    'refuses protected Windows launcher collision %s',
    (name) => {
      expectReason(
        () =>
          assertGlobalPackageMutable(
            protection({ targetBins: [{ name, target: 'bin/tool.js' }] }),
          ),
        'PROTECTED_PACKAGE',
      );
    },
  );
  it.each(['next', 'nest', 'tsc', 'tsserver', 'tsx', 'ts-node'])(
    'leaves ordinary global tooling bin %s manageable',
    (name) => {
      expect(() =>
        assertGlobalPackageMutable(
          protection({
            packageName: 'typescript',
            currentBins: [{ name, target: 'bin/tool.js' }],
            targetBins: [],
            binOwners: [{ name, owner: 'typescript' }],
          }),
        ),
      ).not.toThrow();
    },
  );
  it('allows unchanged own bins and binless packages without changing input', () => {
    const input = protection();
    const before = JSON.stringify(input);
    Object.freeze(input.currentBins);
    Object.freeze(input.targetBins);
    Object.freeze(input.binOwners);
    expect(() =>
      assertGlobalPackageMutable(Object.freeze(input)),
    ).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
    expect(() =>
      assertGlobalPackageMutable(
        protection({ currentBins: [], targetBins: [], binOwners: [] }),
      ),
    ).not.toThrow();
  });
  it.each(['other', null])('refuses a bin owned by %p', (owner) => {
    expectReason(
      () =>
        assertGlobalPackageMutable(
          protection({ binOwners: [{ name: 'TEST-TOOL', owner }] }),
        ),
      'BIN_CONFLICT',
    );
  });
  it('checks newly introduced bins against other packages', () => {
    expectReason(
      () =>
        assertGlobalPackageMutable(
          protection({
            targetBins: [{ name: 'other-tool', target: 'bin/tool.js' }],
            binOwners: [{ name: 'other-tool', owner: 'other' }],
          }),
        ),
      'BIN_CONFLICT',
    );
  });
  it('refuses unsafe bin metadata even when a caller bypasses normalization', () => {
    expectReason(
      () =>
        assertGlobalPackageMutable(
          protection({
            targetBins: [{ name: '../test-tool', target: 'bin/tool.js' }],
          }),
        ),
      'BIN_CONFLICT',
    );
    expectReason(
      () =>
        assertGlobalPackageMutable(
          protection({
            currentBins: [{ name: 'test-tool', target: '../escape.js' }],
          }),
        ),
      'BIN_CONFLICT',
    );
  });
  it('refuses incomplete ownership or duplicate owners', () => {
    expectReason(
      () =>
        assertGlobalPackageMutable(protection({ ownershipComplete: false })),
      'BIN_CONFLICT',
    );
    expectReason(
      () =>
        assertGlobalPackageMutable(
          protection({
            binOwners: [
              { name: 'test-tool', owner: '@test/tool' },
              { name: 'TEST-TOOL', owner: 'other' },
            ],
          }),
        ),
      'BIN_CONFLICT',
    );
  });
  it('refuses linked packages before any outside manifest access', () => {
    expectReason(
      () => assertGlobalPackageMutable(protection({ linked: true })),
      'LINKED_PACKAGE',
    );
  });
  it.each([
    'D:\\TEST\\NODE',
    'd:\\test\\app\\child',
    'D:\\TEST',
    'D:\\TEST\\source',
    'D:\\TEST\\data\\child',
  ])('refuses distribution or ancestor overlap at %s', (packageRoot) => {
    expectReason(
      () => assertGlobalPackageMutable(protection({ packageRoot })),
      'PROTECTED_PACKAGE',
    );
  });
  it('uses path boundaries rather than substring matching', () => {
    expect(() =>
      assertGlobalPackageMutable(
        protection({ packageRoot: 'D:\\TEST\\application' }),
      ),
    ).not.toThrow();
  });
  it('rejects aliases even if the caller bypasses DTOs', () => {
    expectReason(
      () =>
        assertGlobalPackageMutable(
          protection({ packageName: 'alias@npm:npm' }),
        ),
      'INVALID_PACKAGE_SPEC',
    );
  });
});

describe('version policy', () => {
  it.each([
    ['1.2.3', '1.2.3'],
    ['1.2.3+one', '1.2.3+two'],
  ])('refuses no semantic version change from %s to %s', (current, target) => {
    expectReason(
      () => assessGlobalVersionChange(current, target),
      'NO_VERSION_CHANGE',
    );
  });
  it.each([
    ['1.2.3', '1.2.4', []],
    ['1.2.3', '2.0.0', ['MAJOR_VERSION_CHANGE']],
    ['2.1.0', '1.9.0', ['MAJOR_VERSION_CHANGE', 'VERSION_DOWNGRADE']],
    ['1.2.3', '1.2.2', ['VERSION_DOWNGRADE']],
    ['1.2.3', '2.0.0-beta.1', ['MAJOR_VERSION_CHANGE', 'PRERELEASE_VERSION']],
    ['1.2.3', '1.2.3-beta.1', ['VERSION_DOWNGRADE', 'PRERELEASE_VERSION']],
  ] as const)(
    'warns, allowing change from %s to %s',
    (current, target, warnings) => {
      expect(assessGlobalVersionChange(current, target)).toEqual(warnings);
    },
  );
  it.each([
    ['bad', '1.2.3'],
    ['1.2.3', 'latest'],
    ['1.2.3', '^2.0.0'],
  ])('requires resolved exact versions: %s to %s', (current, target) => {
    expectReason(
      () => assessGlobalVersionChange(current, target),
      'INVALID_PACKAGE_SPEC',
    );
  });
});

describe('shared machine-wide risk and exact confirmation', () => {
  afterEach(() => jest.restoreAllMocks());
  it('delegates to shared assessRisk with MACHINE_WIDE', () => {
    const shared = jest.spyOn(sharedRisk, 'assessRisk');
    const risk = getGlobalRisk();
    expect(shared).toHaveBeenCalledWith(['MACHINE_WIDE']);
    expect(risk).toEqual(assessRisk(['MACHINE_WIDE']));
    expect(risk.level).toBe('high');
  });
  it.each(['npm', 'pnpm'] as const)(
    'builds server confirmation for %s',
    (manager) => {
      expect(globalConfirmText(manager, 'remove', '@test/tool', null)).toBe(
        `REMOVE GLOBAL ${manager} @test/tool`,
      );
      expect(globalConfirmText(manager, 'change', '@test/tool', '2.0.0')).toBe(
        `CHANGE GLOBAL ${manager} @test/tool TO 2.0.0`,
      );
    },
  );
  it('requires a resolved exact target for change', () => {
    expectReason(
      () => globalConfirmText('npm', 'change', 'tool', null),
      'INVALID_PACKAGE_SPEC',
    );
    expectReason(
      () => globalConfirmText('npm', 'change', 'tool', 'latest'),
      'INVALID_PACKAGE_SPEC',
    );
  });
  it('shared validation refuses missing consent, missing risk and altered case/whitespace', () => {
    const risk = getGlobalRisk();
    const text = globalConfirmText('npm', 'remove', '@test/tool', null);
    const valid = {
      confirm: true,
      acknowledgedRisks: ['MACHINE_WIDE'],
      confirmText: text,
    };
    expect(() => validateConfirmation(risk, text, valid)).not.toThrow();
    for (const patch of [
      { confirm: false },
      { acknowledgedRisks: [] },
      { confirmText: text.toLowerCase() },
      { confirmText: ` ${text}` },
      { confirmText: `${text} ` },
    ])
      expect(() =>
        validateConfirmation(risk, text, { ...valid, ...patch }),
      ).toThrow();
  });
});
