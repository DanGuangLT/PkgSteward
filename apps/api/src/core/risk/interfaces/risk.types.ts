export type RiskLevel = 'low' | 'medium' | 'high';

export type RiskCode =
  | 'ORPHAN_NODE_MODULES'
  | 'NO_LOCKFILE'
  | 'UNCOMMITTED_GIT_CHANGES'
  | 'RECENTLY_ACTIVE'
  | 'DEV_PROCESS_RUNNING'
  | 'LARGE_BATCH'
  | 'DELETE_WHOLE_PROJECT'
  | 'MACHINE_WIDE'
  | 'UNVERIFIED_CLEANUP_TARGET'
  | 'RISK_CHECK_INCOMPLETE'
  | 'DELETE_PROJECT_CONTENT';

export interface IRiskReason {
  code: RiskCode;
  level: RiskLevel;
  message: string;
}

export interface IRisk {
  level: RiskLevel;
  reasons: IRiskReason[];
}

export interface IConfirmationInput {
  confirm?: unknown;
  acknowledgedRisks?: unknown;
  confirmText?: unknown;
}
