import {
  parsePmPin,
  isPmTargetVersion,
  getPmTargetReason,
  resolvePmTarget,
  assessPmPinChange,
  getPmRisk,
} from '@/package-managers/pinning/pm-policy';
import type { IPmInstalledTool } from '@/package-managers/interfaces/pm.types';
import type { IPmPinChangeInput } from '@/package-managers/pinning/pm-policy';
import { validateConfirmation } from '@/core/risk/confirmation';

const tool: IPmInstalledTool = {
  manager: 'pnpm',
  version: '11.22.0',
  toolPath: 'D:\\TEST\\pnpm.cjs',
  status: 'available',
  reason: null,
};
const input = (
  overrides: Partial<IPmPinChangeInput> = {},
): IPmPinChangeInput => ({
  pin: parsePmPin('pnpm@11.21.0'),
  manager: 'pnpm',
  installed: tool,
  targetVersion: '11.22.0',
  lockManagers: ['pnpm'],
  workspace: { kind: 'standalone', root: null },
  devEnginesPresent: false,
  inputReason: null,
  ...overrides,
});
const catalog = {
  versions: ['11.21.0', '11.22.0', '10.9.0', '11.23.0-beta.1'],
  distTags: { latest: '11.22.0', next: '11.23.0-beta.1' },
  deprecatedVersions: ['11.21.0'],
};

describe('current declaration parsing', () => {
  it('distinguishes no pin from inert null/non-string values', () => {
    expect(parsePmPin(undefined).pinState).toBe('missing');
    expect(parsePmPin(undefined, true).pinState).toBe('unsupported');
    for (const raw of [null, false, 11, {}, []])
      expect(parsePmPin(raw)).toMatchObject({
        pinState: 'unsupported',
        pinReason: 'PIN_UNSUPPORTED',
        parsedPin: null,
      });
  });
  it.each(['npm', 'pnpm', 'yarn'])(
    'reads %s canonical exact/prerelease pins',
    (manager) => {
      expect(parsePmPin(`${manager}@11.2.0-beta.1`)).toMatchObject({
        pinState: 'parsed',
        parsedPin: { manager, version: '11.2.0-beta.1', hash: null },
      });
    },
  );
  it.each([
    ['sha224', 56],
    ['sha256', 64],
    ['sha384', 96],
    ['sha512', 128],
  ] as const)('accepts only the full %s digest', (algorithm, size) => {
    const hash = `${algorithm}.${'A'.repeat(size)}`;
    expect(parsePmPin(`pnpm@11.1.0+${hash}`).parsedPin?.hash).toBe(hash);
    expect(
      parsePmPin(`pnpm@11.1.0+${algorithm}.${'a'.repeat(size - 1)}`).pinState,
    ).toBe('unsupported');
    expect(
      parsePmPin(`pnpm@11.1.0+${algorithm}.${'g'.repeat(size)}`).pinState,
    ).toBe('unsupported');
  });
  it.each([
    'pnpm@latest',
    'pnpm@^11.1.0',
    'pnpm@v11.1.0',
    'pnpm@01.1.0',
    'pnpm@11.1.0-01',
    'npm@11.1.0+build.1',
    'pnpm@11.1.0+sha1.abc',
    'pnpm@11.1.0\n',
    'PNPM@11.1.0',
    'https://example.invalid/tool.tgz',
    'corepack@1.0.0',
  ])('keeps unsupported value inert: %p', (raw) => {
    expect(parsePmPin(raw)).toMatchObject({
      rawPin: raw,
      pinReason: 'PIN_UNSUPPORTED',
    });
  });
  it('bounds display without hiding unsupported state', () => {
    const result = parsePmPin('x'.repeat(5000));
    expect(result.rawPin!.length).toBeLessThanOrEqual(1024);
    expect(result.rawPinTruncated).toBe(true);
    expect(result.pinReason).toBe('PIN_UNSUPPORTED');
    expect(parsePmPin({ secret: '\nTEST' }).rawPin).toBe(
      '{"secret":"\\nTEST"}',
    );
  });
});

describe('public target policy', () => {
  it.each([
    ['npm', '11.17.0', '11.21.2', null],
    ['npm', '12.2.2', '12.2.1', null],
    ['npm', '11.17.0', '12.2.2', 'TARGET_VERSION_UNSUPPORTED'],
    ['npm', '12.2.2', '11.21.2', 'TARGET_VERSION_UNSUPPORTED'],
    ['pnpm', '11.22.0', '11.28.9', null],
    ['pnpm', '11.22.0', '12.18.0', 'TARGET_VERSION_UNSUPPORTED'],
    ['pnpm', '12.18.0', '12.18.0', 'TOOL_VERSION_MISMATCH'],
  ] as const)(
    'keeps %s installed %s and target %s in the same supported major',
    (manager, installed, target, reason) => {
      expect(getPmTargetReason(manager, installed, target, false)).toBe(reason);
    },
  );
  it.each([
    '10.9.0',
    '13.0.0',
    '12.2.2-beta.1',
    'v12.2.2',
    '12.2.2+build',
    '012.2.2',
    '12.2.2\n',
  ])('refuses unsupported/noncanonical npm 12 inputs %p', (version) => {
    expect(getPmTargetReason('npm', version, '12.2.2', false)).toBe(
      'TOOL_VERSION_MISMATCH',
    );
    expect(getPmTargetReason('npm', '12.2.2', version, false)).toBe(
      'TARGET_VERSION_UNSUPPORTED',
    );
  });
  it('refuses deprecated npm 12 targets', () => {
    expect(getPmTargetReason('npm', '12.2.2', '12.2.1', true)).toBe(
      'TARGET_VERSION_UNSUPPORTED',
    );
  });
  it.each(['11.22.0', '11.22.0-beta.1', 'latest', 'next-11'])(
    'accepts bounded request syntax %s',
    (value) => expect(isPmTargetVersion(value)).toBe(true),
  );
  it.each([
    null,
    '',
    'v11.22.0',
    '^11.22.0',
    '11.22.0+build',
    '01.22.0',
    ' latest',
    '--force',
    'file:x',
  ])('rejects unsafe/noncanonical target %p', (value) =>
    expect(isPmTargetVersion(value)).toBe(false),
  );
  it('requires a supported installed major and a stable nondeprecated target of that major', () => {
    expect(getPmTargetReason('pnpm', '11.22.0', '11.20.0', false)).toBeNull();
    expect(getPmTargetReason('yarn', '11.22.0', '1.22.22', false)).toBe(
      'UNSUPPORTED_MANAGER',
    );
    expect(getPmTargetReason('npm', null, '11.20.0', false)).toBe(
      'TOOL_NOT_FOUND',
    );
    expect(getPmTargetReason('npm', '10.9.0', '11.20.0', false)).toBe(
      'TOOL_VERSION_MISMATCH',
    );
    for (const version of ['10.9.0', '12.0.0', '11.23.0-beta.1', 'v11.20.0'])
      expect(getPmTargetReason('npm', '11.22.0', version, false)).toBe(
        'TARGET_VERSION_UNSUPPORTED',
      );
    expect(getPmTargetReason('npm', '11.22.0', '11.20.0', true)).toBe(
      'TARGET_VERSION_UNSUPPORTED',
    );
  });
  it('resolves an exact or current tag only from fresh provided public metadata', () => {
    expect(resolvePmTarget('pnpm', 'latest', '11.22.0', catalog)).toBe(
      '11.22.0',
    );
    expect(resolvePmTarget('pnpm', '11.22.0', '11.22.0', catalog)).toBe(
      '11.22.0',
    );
    for (const requested of ['missing', '11.99.0', '11.21.0', 'next', '10.9.0'])
      expect(() =>
        resolvePmTarget('pnpm', requested, '11.22.0', catalog),
      ).toThrow(
        expect.objectContaining({
          details: { reason: 'TARGET_VERSION_UNSUPPORTED' },
        }),
      );
  });
  it('refuses malformed/overflow catalog facts without silently substituting latest', () => {
    for (const metadata of [
      { ...catalog, versions: ['v11.22.0'] },
      { ...catalog, distTags: { latest: '11.99.0' } },
      { ...catalog, deprecatedVersions: ['11.99.0'] },
      { ...catalog, versions: ['11.22.0', '11.22.0'] },
    ])
      expect(() =>
        resolvePmTarget('pnpm', 'latest', '11.22.0', metadata),
      ).toThrow(
        expect.objectContaining({
          details: { reason: 'REGISTRY_INVALID_RESPONSE' },
        }),
      );
    expect(() =>
      resolvePmTarget('pnpm', 'latest', '11.22.0', {
        ...catalog,
        versions: Array<string>(10001).fill('11.22.0'),
      }),
    ).toThrow(
      expect.objectContaining({ details: { reason: 'LIMIT_EXCEEDED' } }),
    );
  });
});

describe('project pin eligibility', () => {
  it.each([
    ['11.17.0', '12.2.1', '11.21.2'],
    ['12.2.2', '11.17.0', '12.2.1'],
  ])(
    'repairs installed %s from old %s to %s only',
    (installed, old, target) => {
      const repair = input({
        manager: 'npm',
        installed: { ...tool, manager: 'npm', version: installed },
        pin: parsePmPin(`npm@${old}`),
        targetVersion: target,
        lockManagers: ['npm'],
        inputReason: 'TOOL_VERSION_MISMATCH',
      });
      expect(assessPmPinChange(repair)).toMatchObject({
        eligible: true,
        targetPin: `npm@${target}`,
      });
      expect(
        assessPmPinChange({ ...repair, inputReason: 'CONFIG_UNSUPPORTED' })
          .reason,
      ).toBe('CONFIG_UNSUPPORTED');
      expect(
        assessPmPinChange({ ...repair, lockManagers: ['npm', 'pnpm'] }).reason,
      ).toBe('LOCKFILE_MISMATCH');
      expect(
        assessPmPinChange({
          ...repair,
          workspace: { kind: 'leaf', root: 'D:\\TEST' },
        }).reason,
      ).toBe('WORKSPACE_LEAF');
      expect(
        assessPmPinChange({ ...repair, devEnginesPresent: true }).reason,
      ).toBe('CONFIG_UNSUPPORTED');
      expect(assessPmPinChange({ ...repair, targetVersion: old }).reason).toBe(
        'TARGET_VERSION_UNSUPPORTED',
      );
      expect(
        assessPmPinChange({
          ...repair,
          pin: parsePmPin(`npm@${target}`),
        }).reason,
      ).toBe('TOOL_VERSION_MISMATCH');
    },
  );
  it('allows no-pin insertion with an installed supported manager', () => {
    expect(
      assessPmPinChange(
        input({ pin: parsePmPin(undefined), lockManagers: [] }),
      ),
    ).toMatchObject({
      eligible: true,
      targetPin: 'pnpm@11.22.0',
      reason: null,
    });
  });
  it('drops an old-version hash with a notice and never rewrites the same version', () => {
    expect(
      assessPmPinChange(
        input({ pin: parsePmPin(`pnpm@11.21.0+sha256.${'a'.repeat(64)}`) }),
      ).warnings,
    ).toContain('PIN_HASH_REMOVED');
    expect(
      assessPmPinChange(
        input({ pin: parsePmPin(`pnpm@11.22.0+sha256.${'a'.repeat(64)}`) }),
      ).reason,
    ).toBe('NO_VERSION_CHANGE');
    expect(
      assessPmPinChange(input({ pin: parsePmPin('pnpm@11.22.0') })).reason,
    ).toBe('NO_VERSION_CHANGE');
  });
  it('repairs only an old-pin major mismatch while all other safety checks hold', () => {
    const oldPin = input({
      pin: parsePmPin('pnpm@10.9.0'),
      inputReason: 'TOOL_VERSION_MISMATCH',
    });
    expect(assessPmPinChange(oldPin).eligible).toBe(true);
    expect(
      assessPmPinChange({ ...oldPin, inputReason: 'CONFIG_UNSUPPORTED' })
        .reason,
    ).toBe('CONFIG_UNSUPPORTED');
    expect(
      assessPmPinChange({
        ...oldPin,
        installed: { ...tool, version: '10.9.0' },
      }).eligible,
    ).toBe(false);
    expect(
      assessPmPinChange(input({ inputReason: 'TOOL_VERSION_MISMATCH' }))
        .eligible,
    ).toBe(false);
  });
  it('permits manager switches only without conflicting/ambiguous lock families', () => {
    expect(
      assessPmPinChange(
        input({ pin: parsePmPin('npm@11.1.0'), lockManagers: [] }),
      ).eligible,
    ).toBe(true);
    for (const lockManagers of [['npm'], ['npm', 'pnpm']] as const)
      expect(assessPmPinChange(input({ lockManagers })).reason).toBe(
        'LOCKFILE_MISMATCH',
      );
  });
  it('allows workspace roots but refuses leaves, devEngines, inert declarations, and unsafe input', () => {
    expect(
      assessPmPinChange(
        input({ workspace: { kind: 'root', root: 'D:\\TEST' } }),
      ).eligible,
    ).toBe(true);
    expect(
      assessPmPinChange(
        input({ workspace: { kind: 'leaf', root: 'D:\\TEST' } }),
      ).reason,
    ).toBe('WORKSPACE_LEAF');
    const devEngines = assessPmPinChange(input({ devEnginesPresent: true }));
    expect(devEngines.reason).toBe('CONFIG_UNSUPPORTED');
    expect(devEngines.warnings).toContain('DEV_ENGINES_NOT_MANAGED');
    expect(
      assessPmPinChange(input({ pin: parsePmPin({ name: 'pnpm' }) })).reason,
    ).toBe('PIN_UNSUPPORTED');
    expect(
      assessPmPinChange(input({ inputReason: 'CONFIG_UNSUPPORTED' })).eligible,
    ).toBe(false);
    expect(assessPmPinChange(input({ manager: 'yarn' })).reason).toBe(
      'UNSUPPORTED_MANAGER',
    );
    expect(
      assessPmPinChange(
        input({
          installed: {
            ...tool,
            status: 'unavailable',
            reason: 'TOOL_LAYOUT_UNSUPPORTED',
          },
        }),
      ).reason,
    ).toBe('TOOL_LAYOUT_UNSUPPORTED');
  });
  it('always discloses the unchanged runner rather than promising activation', () => {
    expect(assessPmPinChange(input()).warnings).toContain(
      'PIN_DOES_NOT_SWITCH_RUNNER',
    );
  });
});

describe('pin-only risk/confirmation', () => {
  const now = new Date('2026-11-09T00:00:00.000Z');
  it('assesses only stat-derived recent activity using the shared seven-day boundary', () => {
    expect(getPmRisk(null, now)).toEqual({ level: 'low', reasons: [] });
    expect(getPmRisk('bad', now).level).toBe('low');
    expect(getPmRisk('2026-11-01T23:59:59.999Z', now).level).toBe('low');
    expect(
      getPmRisk('2026-11-02T00:00:00.000Z', now).reasons.map(
        ({ code }) => code,
      ),
    ).toEqual(['RECENTLY_ACTIVE']);
  });
  it('uses shared low/medium consent validation without a global confirmation phrase', () => {
    expect(() =>
      validateConfirmation(getPmRisk(null, now), null, { confirm: true }),
    ).not.toThrow();
    const risk = getPmRisk(now.toISOString(), now);
    expect(() => validateConfirmation(risk, null, { confirm: true })).toThrow();
    expect(() =>
      validateConfirmation(risk, null, {
        confirm: true,
        acknowledgedRisks: ['RECENTLY_ACTIVE'],
      }),
    ).not.toThrow();
  });
});
