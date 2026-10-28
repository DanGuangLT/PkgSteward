import { RISK_CATALOG, RISK_THRESHOLDS } from '@/core/risk/risk.catalog';
import {
  assessRisk,
  combineRisks,
  isLargeBatch,
  isRecentlyActive,
  riskIncreased,
} from '@/core/risk/risk';
import type {
  IRisk,
  RiskCode,
  RiskLevel,
} from '@/core/risk/interfaces/risk.types';

const catalogEntries: [RiskCode, RiskLevel, string][] = [
  [
    'DEV_PROCESS_RUNNING',
    'high',
    'A running process appears to use this location',
  ],
  ['DELETE_WHOLE_PROJECT', 'high', 'Deletes the whole project folder'],
  ['DELETE_PROJECT_CONTENT', 'high', 'Deletes project source files or folders'],
  ['MACHINE_WIDE', 'high', 'Changes a machine-wide version'],
  ['UNCOMMITTED_GIT_CHANGES', 'medium', 'Project has uncommitted Git changes'],
  [
    'NO_LOCKFILE',
    'medium',
    'Project has no lockfile, so reinstalling may not restore the same versions',
  ],
  ['RECENTLY_ACTIVE', 'medium', 'Project was active within the last 7 days'],
  ['LARGE_BATCH', 'medium', 'Large batch: 20 or more items, or 5 GB or more'],
  [
    'UNVERIFIED_CLEANUP_TARGET',
    'medium',
    'Folder name matches a build cache, but the project does not use the matching tool',
  ],
  [
    'RISK_CHECK_INCOMPLETE',
    'medium',
    'Some risk checks could not be completed',
  ],
  [
    'ORPHAN_NODE_MODULES',
    'low',
    'node_modules folder whose parent has no package.json',
  ],
];

const orphan: IRisk = {
  level: 'low',
  reasons: [
    {
      code: 'ORPHAN_NODE_MODULES',
      level: 'low',
      message: 'node_modules folder whose parent has no package.json',
    },
  ],
};
const noLockfile: IRisk = {
  level: 'medium',
  reasons: [
    {
      code: 'NO_LOCKFILE',
      level: 'medium',
      message:
        'Project has no lockfile, so reinstalling may not restore the same versions',
    },
  ],
};
const active: IRisk = {
  level: 'medium',
  reasons: [
    {
      code: 'RECENTLY_ACTIVE',
      level: 'medium',
      message: 'Project was active within the last 7 days',
    },
  ],
};

describe('risk catalog', () => {
  it('lists exactly the eleven codes in the specified tie-break order', () => {
    expect(Object.keys(RISK_CATALOG)).toEqual(
      catalogEntries.map(([code]) => code),
    );
  });

  it.each(catalogEntries)(
    '%s has level %s and its public message',
    (code, level, message) => {
      expect(RISK_CATALOG[code]).toEqual({ level, message });
    },
  );

  it('exports seven days, twenty items and five decimal GB as thresholds', () => {
    expect(RISK_THRESHOLDS).toEqual({
      recentlyActiveMs: 604_800_000,
      largeBatchCount: 20,
      largeBatchBytes: 5_000_000_000,
    });
  });
});

describe('assessRisk', () => {
  it('returns low with no reasons for an empty list', () => {
    expect(assessRisk([])).toEqual({ level: 'low', reasons: [] });
  });

  it.each(catalogEntries)(
    'maps %s to its canonical level and message',
    (code, level, message) => {
      expect(assessRisk([code])).toEqual({
        level,
        reasons: [{ code, level, message }],
      });
    },
  );

  it('deduplicates reasons without mutating a readonly input', () => {
    const codes = Object.freeze<RiskCode[]>([
      'NO_LOCKFILE',
      'ORPHAN_NODE_MODULES',
      'NO_LOCKFILE',
      'ORPHAN_NODE_MODULES',
    ]);
    expect(assessRisk(codes)).toEqual({
      level: 'medium',
      reasons: [...noLockfile.reasons, ...orphan.reasons],
    });
    expect(codes).toEqual([
      'NO_LOCKFILE',
      'ORPHAN_NODE_MODULES',
      'NO_LOCKFILE',
      'ORPHAN_NODE_MODULES',
    ]);
  });

  it('orders high before medium before low and uses the highest level', () => {
    expect(
      assessRisk(['ORPHAN_NODE_MODULES', 'NO_LOCKFILE', 'DEV_PROCESS_RUNNING']),
    ).toEqual({
      level: 'high',
      reasons: [
        {
          code: 'DEV_PROCESS_RUNNING',
          level: 'high',
          message: 'A running process appears to use this location',
        },
        ...noLockfile.reasons,
        ...orphan.reasons,
      ],
    });
  });

  it('uses catalog order for every tie regardless of caller order', () => {
    const reversed = catalogEntries.map(([code]) => code).reverse();
    expect(assessRisk(reversed)).toEqual({
      level: 'high',
      reasons: catalogEntries.map(([code, level, message]) => ({
        code,
        level,
        message,
      })),
    });
  });

  it('returns independent objects so caller edits cannot corrupt later risks or the catalog', () => {
    const first = assessRisk(['NO_LOCKFILE']);
    const second = assessRisk(['NO_LOCKFILE']);
    expect(first).not.toBe(second);
    expect(first.reasons).not.toBe(second.reasons);
    expect(first.reasons[0]).not.toBe(second.reasons[0]);
    expect(first.reasons[0]).not.toBe(RISK_CATALOG.NO_LOCKFILE);
    first.level = 'high';
    first.reasons[0].level = 'high';
    first.reasons[0].message = 'changed by caller';
    first.reasons[0].code = 'MACHINE_WIDE';
    first.reasons.length = 0;
    expect(second).toEqual(noLockfile);
    expect(assessRisk(['NO_LOCKFILE'])).toEqual(noLockfile);
    expect(RISK_CATALOG.NO_LOCKFILE).toEqual({
      level: 'medium',
      message:
        'Project has no lockfile, so reinstalling may not restore the same versions',
    });
  });
});

describe('combineRisks', () => {
  it('returns an empty low risk when nothing is supplied', () => {
    expect(combineRisks([])).toEqual({ level: 'low', reasons: [] });
  });

  it('combines overlapping risks and defaults extra codes to an empty list', () => {
    expect(combineRisks([orphan, noLockfile, orphan])).toEqual({
      level: 'medium',
      reasons: [...noLockfile.reasons, ...orphan.reasons],
    });
  });

  it('deduplicates and sorts the union with extra codes', () => {
    expect(
      combineRisks(
        [orphan, noLockfile],
        ['NO_LOCKFILE', 'DEV_PROCESS_RUNNING'],
      ),
    ).toEqual({
      level: 'high',
      reasons: [
        {
          code: 'DEV_PROCESS_RUNNING',
          level: 'high',
          message: 'A running process appears to use this location',
        },
        ...noLockfile.reasons,
        ...orphan.reasons,
      ],
    });
  });

  it('accepts extra codes without existing risks', () => {
    expect(combineRisks([], ['ORPHAN_NODE_MODULES'])).toEqual(orphan);
  });

  it('derives metadata from codes and does not mutate or reuse the supplied reasons', () => {
    const reason = Object.freeze({
      code: 'NO_LOCKFILE' as const,
      level: 'low' as const,
      message: 'untrusted metadata',
    });
    const input: IRisk = { level: 'low', reasons: [reason] };
    Object.freeze(input.reasons);
    Object.freeze(input);
    const result = combineRisks(Object.freeze([input]));
    expect(result).toEqual(noLockfile);
    expect(result.reasons[0]).not.toBe(reason);
    expect(input).toEqual({ level: 'low', reasons: [reason] });
  });
});

describe('riskIncreased', () => {
  it.each<[RiskLevel, RiskLevel]>([
    ['low', 'medium'],
    ['low', 'high'],
    ['medium', 'high'],
  ])(
    'detects a level increase from %s to %s even without new codes',
    (before, after) => {
      expect(
        riskIncreased(
          { level: before, reasons: [] },
          { level: after, reasons: [] },
        ),
      ).toBe(true);
    },
  );

  it('detects a new code at the same level', () => {
    expect(riskIncreased(noLockfile, active)).toBe(true);
  });

  it('detects a new code even if the overall level decreases', () => {
    expect(riskIncreased({ ...noLockfile, level: 'high' }, active)).toBe(true);
  });

  it('does not increase when a code is removed', () => {
    expect(
      riskIncreased(
        {
          level: 'medium',
          reasons: [...noLockfile.reasons, ...orphan.reasons],
        },
        noLockfile,
      ),
    ).toBe(false);
  });

  it('does not increase when level and codes decrease', () => {
    expect(riskIncreased(noLockfile, { level: 'low', reasons: [] })).toBe(
      false,
    );
  });

  it('does not increase for identical risks', () => {
    expect(riskIncreased(noLockfile, structuredClone(noLockfile))).toBe(false);
  });

  it('ignores reason order, duplicate codes and message changes', () => {
    const before: IRisk = {
      level: 'medium',
      reasons: [...noLockfile.reasons, ...active.reasons],
    };
    const after: IRisk = {
      level: 'medium',
      reasons: [
        ...active.reasons,
        { ...noLockfile.reasons[0], message: 'new wording' },
        ...active.reasons,
      ],
    };
    expect(riskIncreased(before, after)).toBe(false);
  });
});

describe('isRecentlyActive', () => {
  const now = new Date('2026-10-28T12:00:00.000Z');

  it.each([
    ['2026-10-21T12:00:00.001Z', true],
    ['2026-10-21T12:00:00.000Z', true],
    ['2026-10-21T11:59:59.999Z', false],
    ['2026-10-28T12:00:00.000Z', true],
    ['2026-10-29T12:00:00.000Z', true],
    ['2026-10-21T19:00:00.000+07:00', true],
    ['not a date', false],
    ['', false],
  ])(
    'evaluates %s against the injected clock as %s',
    (lastActivityAt, expected) => {
      expect(isRecentlyActive(lastActivityAt, now)).toBe(expected);
    },
  );
});

describe('isLargeBatch', () => {
  it.each([
    [0, 0, false],
    [19, 4_999_999_999, false],
    [20, 0, true],
    [21, 0, true],
    [0, 5_000_000_000, true],
    [0, 5_000_000_001, true],
    [20, 5_000_000_000, true],
  ])('classifies %s items and %s bytes as %s', (count, bytes, expected) => {
    expect(isLargeBatch(count, bytes)).toBe(expected);
  });
});
