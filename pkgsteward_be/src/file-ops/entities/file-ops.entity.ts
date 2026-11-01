import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type {
  IRisk,
  IRiskReason,
  RiskCode,
  RiskLevel,
} from '@/core/risk/interfaces/risk.types';
import { RISK_CATALOG } from '@/core/risk/risk.catalog';
import type {
  FileOpsKind,
  FileOpsMethod,
  IFileOpsOperation,
  IFileOpsPreview,
  IFileOpsTarget,
  IFileOpsTargetResult,
  IFileTreeLevel,
  IOperationStart,
  IPreviewStart,
  IPreviewSummary,
  ITargetSize,
  ITreeEntry,
  JobStatus,
} from '@/file-ops/interfaces/file-ops.types';

const JOB_STATUSES: readonly JobStatus[] = [
  'running',
  'completed',
  'cancelled',
  'failed',
];
const OPERATION_STATUSES: readonly IFileOpsOperation['status'][] = [
  'running',
  'stopping',
  'completed',
  'cancelled',
  'failed',
];
const KINDS: readonly FileOpsKind[] = [
  'project',
  'node_modules',
  'orphan_node_modules',
  'build_cache',
  'project_content',
];
const METHODS: readonly FileOpsMethod[] = ['permanent', 'recycle'];
const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];

export class PreviewStartEntity implements IPreviewStart {
  @ApiProperty({ format: 'uuid' })
  previewId!: string;
  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;
}

export class OperationStartEntity implements IOperationStart {
  @ApiProperty({ format: 'uuid' })
  operationId!: string;
  @ApiProperty({ enum: OPERATION_STATUSES })
  status!: IFileOpsOperation['status'];
}

export class RiskReasonEntity implements IRiskReason {
  @ApiProperty({ enum: Object.keys(RISK_CATALOG) })
  code!: RiskCode;
  @ApiProperty({ enum: RISK_LEVELS })
  level!: RiskLevel;
  @ApiProperty()
  message!: string;
}

export class RiskEntity implements IRisk {
  @ApiProperty({ enum: RISK_LEVELS })
  level!: RiskLevel;
  @ApiProperty({ type: [RiskReasonEntity] })
  @Type(() => RiskReasonEntity)
  reasons!: RiskReasonEntity[];
}

export class TargetOwnerEntity {
  @ApiProperty()
  path!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
}

export class TargetSizeEntity implements ITargetSize {
  @ApiProperty({
    enum: ['pending', 'measuring', 'done', 'failed', 'cancelled'],
  })
  status!: ITargetSize['status'];
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Every entry, used for the Recycle Bin capacity check',
  })
  apparentBytes!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Each hardlinked file counted once within the target',
  })
  sizeBytes!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    description: 'Estimated space freed by a permanent deletion',
  })
  reclaimableBytes!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  sharedBytes!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  fileCount!: number | null;
}

export class FileOpsTargetEntity implements IFileOpsTarget {
  @ApiProperty()
  path!: string;
  @ApiProperty({ type: String, nullable: true, enum: [...KINDS, null] })
  kind!: FileOpsKind | null;
  @ApiProperty({ type: String, nullable: true, enum: [...METHODS, null] })
  method!: FileOpsMethod | null;
  @ApiProperty()
  valid!: boolean;
  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;
  @ApiProperty({ type: TargetOwnerEntity, nullable: true })
  @Type(() => TargetOwnerEntity)
  owner!: TargetOwnerEntity | null;
  @ApiProperty({ type: [String] })
  nestedProjects!: string[];
  @ApiProperty({ type: Boolean, nullable: true })
  hasLockfile!: boolean | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastActivityAt!: string | null;
  @ApiProperty({ type: TargetSizeEntity })
  @Type(() => TargetSizeEntity)
  size!: TargetSizeEntity;
  @ApiProperty({ type: RiskEntity })
  @Type(() => RiskEntity)
  risk!: RiskEntity;
  @ApiProperty()
  defaultSelected!: boolean;
}

export class PreviewProgressEntity {
  @ApiProperty({ minimum: 0 })
  measuredTargets!: number;
  @ApiProperty({ minimum: 0 })
  totalTargets!: number;
}

export class FileOpsPreviewEntity implements IFileOpsPreview {
  @ApiProperty({ format: 'uuid' })
  previewId!: string;
  @ApiProperty({ enum: ['cleanup', 'delete'] })
  source!: IFileOpsPreview['source'];
  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;
  @ApiProperty()
  scanId!: string;
  @ApiProperty({ type: PreviewProgressEntity })
  @Type(() => PreviewProgressEntity)
  progress!: PreviewProgressEntity;
  @ApiProperty({ type: [FileOpsTargetEntity] })
  @Type(() => FileOpsTargetEntity)
  targets!: FileOpsTargetEntity[];
  @ApiProperty({ type: RiskEntity })
  @Type(() => RiskEntity)
  risk!: RiskEntity;
  @ApiProperty({ type: String, nullable: true })
  confirmText!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  operationId!: string | null;
  @ApiProperty({ format: 'date-time' })
  startedAt!: string;
  @ApiPropertyOptional({ format: 'date-time' })
  finishedAt?: string;
  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;
}

export class PreviewTotalsEntity {
  @ApiProperty({ minimum: 0 })
  targetCount!: number;
  @ApiProperty({ minimum: 0 })
  reclaimableBytes!: number;
  @ApiProperty({ minimum: 0 })
  recycleBytes!: number;
}

export class PreviewSummaryEntity implements IPreviewSummary {
  @ApiProperty({ type: [String] })
  paths!: string[];
  @ApiProperty({ type: RiskEntity })
  @Type(() => RiskEntity)
  risk!: RiskEntity;
  @ApiProperty({ type: String, nullable: true })
  confirmText!: string | null;
  @ApiProperty({ type: PreviewTotalsEntity })
  @Type(() => PreviewTotalsEntity)
  totals!: PreviewTotalsEntity;
}

export class TargetResultEntity implements IFileOpsTargetResult {
  @ApiProperty()
  path!: string;
  @ApiProperty({ enum: KINDS })
  kind!: FileOpsKind;
  @ApiProperty({ enum: METHODS })
  method!: FileOpsMethod;
  @ApiProperty({
    enum: ['pending', 'running', 'success', 'failed', 'not_started'],
  })
  status!: IFileOpsTargetResult['status'];
  @ApiProperty({ type: String, nullable: true })
  errorCode!: IFileOpsTargetResult['errorCode'];
  @ApiProperty({
    description: 'A failed permanent deletion may have removed part of it',
  })
  mayBePartial!: boolean;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  reclaimableBytes!: number | null;
}

export class FileOpsOperationEntity implements IFileOpsOperation {
  @ApiProperty({ format: 'uuid' })
  operationId!: string;
  @ApiProperty({ format: 'uuid' })
  previewId!: string;
  @ApiProperty({ enum: OPERATION_STATUSES })
  status!: IFileOpsOperation['status'];
  @ApiProperty({ type: String, nullable: true })
  currentPath!: string | null;
  @ApiProperty({ type: [TargetResultEntity] })
  @Type(() => TargetResultEntity)
  results!: TargetResultEntity[];
  @ApiProperty({ format: 'date-time' })
  startedAt!: string;
  @ApiPropertyOptional({ format: 'date-time' })
  finishedAt?: string;
}

export class TreeEntryEntity implements ITreeEntry {
  @ApiProperty()
  name!: string;
  @ApiProperty()
  path!: string;
  @ApiProperty({ enum: ['directory', 'file', 'link', 'other'] })
  type!: ITreeEntry['type'];
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  sizeBytes!: number | null;
  @ApiProperty()
  selectable!: boolean;
}

export class FileTreeLevelEntity implements IFileTreeLevel {
  @ApiProperty()
  path!: string;
  @ApiProperty({ type: TargetOwnerEntity })
  @Type(() => TargetOwnerEntity)
  owner!: TargetOwnerEntity;
  @ApiProperty({ type: [TreeEntryEntity] })
  @Type(() => TreeEntryEntity)
  entries!: TreeEntryEntity[];
  @ApiProperty()
  truncated!: boolean;
}
