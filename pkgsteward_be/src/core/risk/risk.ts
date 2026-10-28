import type {
  IRisk,
  RiskCode,
  RiskLevel,
} from '@/core/risk/interfaces/risk.types';
import { RISK_CATALOG, RISK_THRESHOLDS } from '@/core/risk/risk.catalog';

const LEVEL_RANK: Readonly<Record<RiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function assessRisk(codes: readonly RiskCode[]): IRisk {
  const selected = new Set(codes);
  // Start in catalog order; stable sort preserves that order within each level.
  const reasons = (Object.keys(RISK_CATALOG) as RiskCode[])
    .filter((code) => selected.has(code))
    .map((code) => ({ code, ...RISK_CATALOG[code] }))
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  return { level: reasons[0]?.level ?? 'low', reasons };
}

export function combineRisks(
  risks: readonly IRisk[],
  extraCodes: readonly RiskCode[] = [],
): IRisk {
  return assessRisk([
    ...risks.flatMap((risk) => risk.reasons.map(({ code }) => code)),
    ...extraCodes,
  ]);
}

export function riskIncreased(before: IRisk, after: IRisk): boolean {
  if (LEVEL_RANK[after.level] > LEVEL_RANK[before.level]) return true;

  const previousCodes = new Set(before.reasons.map(({ code }) => code));
  return after.reasons.some(({ code }) => !previousCodes.has(code));
}

export function isRecentlyActive(lastActivityAt: string, now: Date): boolean {
  const timestamp = Date.parse(lastActivityAt);
  return (
    Number.isFinite(timestamp) &&
    now.getTime() - timestamp <= RISK_THRESHOLDS.recentlyActiveMs
  );
}

export function isLargeBatch(count: number, totalBytes: number): boolean {
  return (
    count >= RISK_THRESHOLDS.largeBatchCount ||
    totalBytes >= RISK_THRESHOLDS.largeBatchBytes
  );
}
