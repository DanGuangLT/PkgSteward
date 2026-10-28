import type { RiskCode, RiskLevel } from '@/core/risk/interfaces/risk.types';

export interface IAuditRecord {
  operation: string;
  operationId: string;
  phase: 'intent' | 'result';
  targets: string[];
  method?: string;
  risk: { level: RiskLevel; codes: RiskCode[] };
  result: string;
  errorCode?: string | null;
}

export interface IAuditLogService {
  append(record: IAuditRecord): Promise<void>;
}
