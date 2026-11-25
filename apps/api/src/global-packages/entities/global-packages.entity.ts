import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import type { IRisk } from '@/core/risk/interfaces/risk.types';
import {
  GLOBAL_ACTIONS,
  GLOBAL_JOB_KINDS,
  GLOBAL_JOB_STATUSES,
  GLOBAL_MANAGERS,
  GLOBAL_REASON_CODES,
  GLOBAL_WARNING_CODES,
} from '@/global-packages/interfaces/global-packages.types';
import type {
  IGlobalBin,
  IGlobalBinDiff,
  IGlobalJob,
  IGlobalJobStart,
  IGlobalManagerInventory,
  IGlobalPackage,
  IGlobalPreview,
  IGlobalSnapshot,
  IGlobalVersions,
  IGlobalNpmVersion,
  IGlobalNpmPreview,
  IGlobalNpmRepair,
} from '@/global-packages/interfaces/global-packages.types';

@Exclude()
export class GlobalBinEntity implements IGlobalBin {
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() target!: string;
}
@Exclude()
export class GlobalReplacedBinEntity {
  @Expose()
  @ApiProperty({ type: GlobalBinEntity })
  @Type(() => GlobalBinEntity)
  before!: GlobalBinEntity;
  @Expose()
  @ApiProperty({ type: GlobalBinEntity })
  @Type(() => GlobalBinEntity)
  after!: GlobalBinEntity;
}
@Exclude()
export class GlobalBinDiffEntity implements IGlobalBinDiff {
  @Expose()
  @ApiProperty({ type: [GlobalBinEntity] })
  @Type(() => GlobalBinEntity)
  before!: GlobalBinEntity[];
  @Expose()
  @ApiProperty({ type: [GlobalBinEntity] })
  @Type(() => GlobalBinEntity)
  after!: GlobalBinEntity[];
  @Expose()
  @ApiProperty({ type: [GlobalBinEntity] })
  @Type(() => GlobalBinEntity)
  added!: GlobalBinEntity[];
  @Expose()
  @ApiProperty({ type: [GlobalBinEntity] })
  @Type(() => GlobalBinEntity)
  removed!: GlobalBinEntity[];
  @Expose()
  @ApiProperty({ type: [GlobalReplacedBinEntity] })
  @Type(() => GlobalReplacedBinEntity)
  replaced!: GlobalReplacedBinEntity[];
}
@Exclude()
export class GlobalPackageEntity implements IGlobalPackage {
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() version!: string;
  @Expose()
  @ApiProperty({ type: [GlobalBinEntity] })
  @Type(() => GlobalBinEntity)
  bins!: GlobalBinEntity[];
  @Expose()
  @ApiProperty({ enum: ['manageable', 'protected', 'linked', 'invalid'] })
  status!: IGlobalPackage['status'];
  @Expose()
  @ApiProperty({ type: String, enum: [...GLOBAL_REASON_CODES], nullable: true })
  reason!: IGlobalPackage['reason'];
}
@Exclude()
export class GlobalNpmVersionEntity implements IGlobalNpmVersion {
  @Expose() @ApiProperty() bundledVersion!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) overlayVersion!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) terminalVersion!:
    string | null;
  @Expose() @ApiProperty() prefix!: string;
  @Expose()
  @ApiProperty({
    enum: ['absent', 'present', 'broken', 'linked', 'unsupported'],
  })
  overlayState!: IGlobalNpmVersion['overlayState'];
  @Expose()
  @ApiProperty({ enum: ['verified', 'unverified'] })
  delegation!: IGlobalNpmVersion['delegation'];
  @Expose()
  @ApiProperty({ type: String, enum: [...GLOBAL_REASON_CODES], nullable: true })
  reason!: IGlobalNpmVersion['reason'];
}
@Exclude()
export class GlobalNpmPreviewEntity implements IGlobalNpmPreview {
  @Expose() @ApiProperty() appVersion!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) terminalBefore!:
    string | null;
  @Expose() @ApiProperty() terminalAfter!: string;
  @Expose() @ApiProperty() prefix!: string;
  @Expose() @ApiProperty({ type: [String] }) repairTargets!: string[];
}
@Exclude()
export class GlobalNpmRepairFailureEntity {
  @Expose() @ApiProperty() path!: string;
  @Expose() @ApiProperty({ enum: [...GLOBAL_REASON_CODES] }) code!: NonNullable<
    IGlobalNpmRepair['failed']
  >['code'];
}
@Exclude()
export class GlobalNpmRepairEntity implements IGlobalNpmRepair {
  @Expose() @ApiProperty({ type: [String] }) deleted!: string[];
  @Expose()
  @ApiProperty({ type: GlobalNpmRepairFailureEntity, nullable: true })
  @Type(() => GlobalNpmRepairFailureEntity)
  failed!: GlobalNpmRepairFailureEntity | null;
  @Expose() @ApiProperty({ type: [String] }) remaining!: string[];
}
@Exclude()
export class GlobalManagerInventoryEntity implements IGlobalManagerInventory {
  @Expose()
  @ApiPropertyOptional({ type: GlobalNpmVersionEntity })
  @Type(() => GlobalNpmVersionEntity)
  npmVersion?: GlobalNpmVersionEntity;
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_MANAGERS] })
  manager!: IGlobalManagerInventory['manager'];
  @Expose() @ApiProperty({ type: String, nullable: true }) version!:
    string | null;
  @Expose() @ApiProperty() available!: boolean;
  @Expose()
  @ApiProperty({ type: String, enum: [...GLOBAL_REASON_CODES], nullable: true })
  reason!: IGlobalManagerInventory['reason'];
  @Expose() @ApiProperty({ type: String, nullable: true }) globalRoot!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) binDir!:
    string | null;
  @Expose()
  @ApiProperty({ type: [GlobalPackageEntity] })
  @Type(() => GlobalPackageEntity)
  packages!: GlobalPackageEntity[];
}
@Exclude()
export class GlobalSnapshotEntity implements IGlobalSnapshot {
  @Expose() @ApiProperty() revision!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) asOf!: string;
  @Expose() @ApiProperty() stale!: boolean;
  @Expose()
  @ApiProperty({ type: [GlobalManagerInventoryEntity] })
  @Type(() => GlobalManagerInventoryEntity)
  managers!: GlobalManagerInventoryEntity[];
}
@Exclude()
export class GlobalVersionsEntity implements IGlobalVersions {
  @Expose() @ApiProperty({ type: [String] }) deprecatedVersions!: string[];
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_MANAGERS] })
  manager!: IGlobalVersions['manager'];
  @Expose() @ApiProperty() package!: string;
  @Expose() @ApiProperty({ type: [String] }) versions!: string[];
  @Expose()
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  tags!: Record<string, string>;
}
@Exclude()
export class GlobalSharedPackageEntity {
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() version!: string;
  @Expose() @ApiProperty() linked!: boolean;
}
@Exclude()
export class GlobalPreviewEntity implements IGlobalPreview {
  @Expose()
  @ApiPropertyOptional({
    type: [GlobalSharedPackageEntity],
    description:
      'Other direct dependencies sharing the pnpm 10 or Yarn 1 global project.',
  })
  @Type(() => GlobalSharedPackageEntity)
  sharedPackages?: GlobalSharedPackageEntity[];
  @Expose()
  @ApiPropertyOptional({ type: GlobalNpmPreviewEntity })
  @Type(() => GlobalNpmPreviewEntity)
  npm?: GlobalNpmPreviewEntity;
  @Expose() @ApiProperty({ format: 'uuid' }) previewId!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_MANAGERS] })
  manager!: IGlobalPreview['manager'];
  @Expose() @ApiProperty() managerVersion!: string;
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_ACTIONS] })
  action!: IGlobalPreview['action'];
  @Expose() @ApiProperty() package!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) currentVersion!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) requestedVersion!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) targetVersion!:
    string | null;
  @Expose() @ApiProperty() globalRoot!: string;
  @Expose() @ApiProperty() binDir!: string;
  @Expose()
  @ApiProperty({ type: GlobalBinDiffEntity })
  @Type(() => GlobalBinDiffEntity)
  bins!: GlobalBinDiffEntity;
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_WARNING_CODES], isArray: true })
  warningCodes!: IGlobalPreview['warningCodes'];
  @Expose()
  @ApiProperty({ type: 'object', additionalProperties: true })
  risk!: IRisk;
  @Expose() @ApiProperty() confirmText!: string;
}
@Exclude()
export class GlobalJobStartEntity implements IGlobalJobStart {
  @Expose() @ApiProperty({ format: 'uuid' }) jobId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) requestId!: string;
  @Expose()
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  previewId!: string | null;
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_JOB_STATUSES] })
  status!: IGlobalJobStart['status'];
}
@Exclude()
export class GlobalJobEntity
  extends GlobalJobStartEntity
  implements IGlobalJob
{
  @Expose()
  @ApiPropertyOptional({ type: GlobalNpmRepairEntity, nullable: true })
  @Type(() => GlobalNpmRepairEntity)
  npmRepair?: GlobalNpmRepairEntity | null;
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_JOB_KINDS] })
  kind!: IGlobalJob['kind'];
  @Expose()
  @ApiProperty({ type: String, enum: [...GLOBAL_MANAGERS], nullable: true })
  manager!: IGlobalJob['manager'];
  @Expose() @ApiProperty({ type: String, nullable: true }) managerVersion!:
    string | null;
  @Expose()
  @ApiProperty({ type: String, enum: [...GLOBAL_ACTIONS], nullable: true })
  action!: IGlobalJob['action'];
  @Expose() @ApiProperty({ type: String, nullable: true }) package!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) currentVersion!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) targetVersion!:
    string | null;
  @Expose()
  @ApiProperty({
    enum: ['preflight', 'executing', 'stopping', 'finalizing', 'done'],
  })
  phase!: IGlobalJob['phase'];
  @Expose() @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;
  @Expose() @ApiProperty() mutationSpawned!: boolean;
  @Expose() @ApiProperty() mayHaveChanged!: boolean;
  @Expose() @ApiProperty({ type: Number, nullable: true }) exitCode!:
    number | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) signal!:
    string | null;
  @Expose()
  @ApiProperty({
    type: String,
    enum: ['cancel', 'timeout', 'shutdown'],
    nullable: true,
  })
  stopReason!: IGlobalJob['stopReason'];
  @Expose() @ApiProperty() terminationVerified!: boolean;
  @Expose() @ApiProperty() gateHeld!: boolean;
  @Expose() @ApiProperty() auditWritten!: boolean;
  @Expose() @ApiProperty() refreshRequired!: boolean;
  @Expose()
  @ApiProperty({ type: String, enum: [...GLOBAL_REASON_CODES], nullable: true })
  failureCode!: IGlobalJob['failureCode'];
  @Expose()
  @ApiProperty({ enum: [...GLOBAL_WARNING_CODES], isArray: true })
  warningCodes!: IGlobalJob['warningCodes'];
  @Expose() @ApiProperty({ minimum: 0 }) firstCursor!: number;
  @Expose() @ApiProperty({ minimum: 0 }) endCursor!: number;
  @Expose() @ApiProperty({ minimum: 0 }) droppedBytes!: number;
  @Expose()
  @ApiProperty({ type: GlobalPreviewEntity, nullable: true })
  @Type(() => GlobalPreviewEntity)
  preview!: GlobalPreviewEntity | null;
  @Expose()
  @ApiProperty({ type: GlobalVersionsEntity, nullable: true })
  @Type(() => GlobalVersionsEntity)
  versions!: GlobalVersionsEntity | null;
}
export { RunLogPageEntity as GlobalLogPageEntity } from '@/npm-runner/entities/npm-runner.entity';
