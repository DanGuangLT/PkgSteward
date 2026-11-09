import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';
import type { IRisk, IRiskReason } from '@/core/risk/interfaces/risk.types';
import {
  PM_JOB_KINDS,
  PM_JOB_PHASES,
  PM_JOB_STATUSES,
  PM_LIMITATIONS,
  PM_MANAGERS,
  PM_WARNING_CODES,
  PM_WRITABLE_MANAGERS,
} from '@/package-managers/interfaces/pm.types';
import type {
  IPmContext,
  IPmFileEdit,
  IPmInstalledTool,
  IPmJob,
  IPmJobStart,
  IPmParsedPin,
  IPmPreview,
  IPmVersion,
  IPmVersions,
  IPmWorkspace,
} from '@/package-managers/interfaces/pm.types';

@Exclude()
export class PmParsedPinEntity implements IPmParsedPin {
  @Expose()
  @ApiProperty({ enum: [...PM_MANAGERS] })
  manager!: IPmParsedPin['manager'];
  @Expose() @ApiProperty() version!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) hash!: string | null;
}
@Exclude()
export class PmInstalledToolEntity implements IPmInstalledTool {
  @Expose()
  @ApiProperty({ enum: [...PM_MANAGERS] })
  manager!: IPmInstalledTool['manager'];
  @Expose() @ApiProperty({ type: String, nullable: true }) version!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) toolPath!:
    string | null;
  @Expose()
  @ApiProperty({ enum: ['available', 'unavailable', 'unsupported'] })
  status!: IPmInstalledTool['status'];
  @Expose()
  @ApiProperty({ type: String, nullable: true })
  reason!: IPmInstalledTool['reason'];
}
@Exclude()
export class PmWorkspaceEntity implements IPmWorkspace {
  @Expose()
  @ApiProperty({ enum: ['standalone', 'root', 'leaf'] })
  kind!: IPmWorkspace['kind'];
  @Expose() @ApiProperty({ type: String, nullable: true }) root!: string | null;
}
@Exclude()
export class PmContextEntity implements IPmContext {
  @Expose() @ApiProperty() path!: string;
  @Expose() @ApiProperty() projectName!: string;
  @Expose() @ApiProperty() scanId!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) asOf!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) rawPin!:
    string | null;
  @Expose() @ApiProperty() rawPinTruncated!: boolean;
  @Expose()
  @ApiProperty({ enum: ['missing', 'parsed', 'unsupported'] })
  pinState!: IPmContext['pinState'];
  @Expose()
  @ApiProperty({ type: PmParsedPinEntity, nullable: true })
  @Type(() => PmParsedPinEntity)
  parsedPin!: PmParsedPinEntity | null;
  @Expose()
  @ApiProperty({ type: String, nullable: true })
  pinReason!: IPmContext['pinReason'];
  @Expose()
  @ApiProperty({ type: [PmInstalledToolEntity] })
  @Type(() => PmInstalledToolEntity)
  installed!: PmInstalledToolEntity[];
  @Expose()
  @ApiProperty({ enum: [...PM_MANAGERS], isArray: true })
  lockManagers!: IPmContext['lockManagers'];
  @Expose()
  @ApiProperty({ type: PmWorkspaceEntity })
  @Type(() => PmWorkspaceEntity)
  workspace!: PmWorkspaceEntity;
  @Expose() @ApiProperty() devEnginesPresent!: boolean;
  @Expose()
  @ApiProperty({ type: String, nullable: true })
  reason!: IPmContext['reason'];
  @Expose()
  @ApiProperty({ enum: [...PM_WARNING_CODES], isArray: true })
  warnings!: IPmContext['warnings'];
}
@Exclude()
export class PmVersionEntity implements IPmVersion {
  @Expose() @ApiProperty() version!: string;
  @Expose() @ApiProperty() deprecated!: boolean;
  @Expose() @ApiProperty() supported!: boolean;
  @Expose()
  @ApiProperty({ type: String, nullable: true })
  reason!: IPmVersion['reason'];
}
@Exclude()
export class PmVersionsEntity implements IPmVersions {
  @Expose()
  @ApiProperty({ enum: [...PM_MANAGERS] })
  manager!: IPmVersions['manager'];
  @Expose()
  @ApiProperty({ type: [PmVersionEntity] })
  @Type(() => PmVersionEntity)
  versions!: PmVersionEntity[];
  @Expose()
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  tags!: Record<string, string>;
  @Expose() @ApiProperty({ format: 'date-time' }) asOf!: string;
  @Expose() @ApiProperty() stale!: boolean;
}
@Exclude()
export class PmFileEditEntity implements IPmFileEdit {
  @Expose() @ApiProperty({ enum: ['package.json'] }) file!: 'package.json';
  @Expose() @ApiProperty({ enum: ['packageManager'] }) field!: 'packageManager';
  @Expose()
  @ApiProperty({ enum: ['insert', 'replace'] })
  operation!: IPmFileEdit['operation'];
  @Expose() @ApiProperty({ type: String, nullable: true }) before!:
    string | null;
  @Expose() @ApiProperty() after!: string;
}
@Exclude()
export class PmRiskReasonEntity implements IRiskReason {
  @Expose() @ApiProperty() code!: IRiskReason['code'];
  @Expose()
  @ApiProperty({ enum: ['low', 'medium', 'high'] })
  level!: IRiskReason['level'];
  @Expose() @ApiProperty() message!: string;
}
@Exclude()
export class PmRiskEntity implements IRisk {
  @Expose()
  @ApiProperty({ enum: ['low', 'medium', 'high'] })
  level!: IRisk['level'];
  @Expose()
  @ApiProperty({ type: [PmRiskReasonEntity] })
  @Type(() => PmRiskReasonEntity)
  reasons!: PmRiskReasonEntity[];
}
@Exclude()
export class PmPreviewEntity implements IPmPreview {
  @Expose() @ApiProperty({ format: 'uuid' }) previewId!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @Expose() @ApiProperty() path!: string;
  @Expose() @ApiProperty() projectName!: string;
  @Expose() @ApiProperty() scanId!: string;
  @Expose()
  @ApiProperty({ enum: [...PM_WRITABLE_MANAGERS] })
  manager!: IPmPreview['manager'];
  @Expose() @ApiProperty({ type: String, nullable: true }) rawPin!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) currentVersion!:
    string | null;
  @Expose() @ApiProperty() requestedVersion!: string;
  @Expose() @ApiProperty() targetVersion!: string;
  @Expose() @ApiProperty() installedRunnerVersion!: string;
  @Expose() @ApiProperty({ enum: ['manifest-pin'] }) method!: 'manifest-pin';
  @Expose()
  @ApiProperty({ type: PmFileEditEntity })
  @Type(() => PmFileEditEntity)
  edit!: PmFileEditEntity;
  @Expose()
  @ApiProperty({ enum: [...PM_WARNING_CODES], isArray: true })
  warnings!: IPmPreview['warnings'];
  @Expose()
  @ApiProperty({ enum: [...PM_LIMITATIONS], isArray: true })
  limitations!: IPmPreview['limitations'];
  @Expose()
  @ApiProperty({ type: PmRiskEntity })
  @Type(() => PmRiskEntity)
  risk!: PmRiskEntity;
  @Expose()
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Always null for project pin changes',
  })
  confirmText!: null;
}
@Exclude()
export class PmJobStartEntity implements IPmJobStart {
  @Expose() @ApiProperty({ format: 'uuid' }) jobId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) requestId!: string;
  @Expose()
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  previewId!: string | null;
  @Expose()
  @ApiProperty({ enum: [...PM_JOB_STATUSES] })
  status!: IPmJobStart['status'];
}
@Exclude()
export class PmJobEntity extends PmJobStartEntity implements IPmJob {
  @Expose() @ApiProperty({ enum: [...PM_JOB_KINDS] }) kind!: IPmJob['kind'];
  @Expose() @ApiProperty() path!: string;
  @Expose()
  @ApiProperty({ enum: [...PM_MANAGERS] })
  manager!: IPmJob['manager'];
  @Expose() @ApiProperty({ enum: [...PM_JOB_PHASES] }) phase!: IPmJob['phase'];
  @Expose() @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;
  @Expose() @ApiProperty() cancelRequested!: boolean;
  @Expose() @ApiProperty() mutationStarted!: boolean;
  @Expose() @ApiProperty() fileCommitted!: boolean;
  @Expose() @ApiProperty() mayHaveChanged!: boolean;
  @Expose() @ApiProperty() gateHeld!: boolean;
  @Expose() @ApiProperty() auditWritten!: boolean;
  @Expose() @ApiProperty() refreshRequired!: boolean;
  @Expose() @ApiProperty() cleanupRequired!: boolean;
  @Expose()
  @ApiProperty({ type: String, nullable: true })
  failureCode!: IPmJob['failureCode'];
  @Expose()
  @ApiProperty({ enum: [...PM_WARNING_CODES], isArray: true })
  warnings!: IPmJob['warnings'];
  @Expose()
  @ApiProperty({ type: PmPreviewEntity, nullable: true })
  @Type(() => PmPreviewEntity)
  preview!: PmPreviewEntity | null;
  @Expose()
  @ApiProperty({ type: PmVersionsEntity, nullable: true })
  @Type(() => PmVersionsEntity)
  versions!: PmVersionsEntity | null;
}
