import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type {
  IAnalysisSection,
  IDependencyDeclaration,
  IProjectAdvisory,
  IProjectAnalysisJob,
  IProjectAnalysisStart,
  IProjectDependency,
  IProjectDetail,
  IProjectOutdated,
  IProjectScript,
  ProjectAnalysisCode,
} from '@/projects/interfaces/projects.types';

const codes: ProjectAnalysisCode[] = [
  'INPUT_CHANGED',
  'PROJECT_NOT_SCANNED',
  'CANCELLED',
  'TIMED_OUT',
  'UNREADABLE_INPUT',
  'INVALID_LOCKFILE',
  'NO_LOCKFILE',
  'UNSUPPORTED_LOCKFILE',
  'LOCKFILE_MISMATCH',
  'UNSUPPORTED_MANAGER',
  'UNSUPPORTED_SPEC',
  'REGISTRY_CONFIG_UNSUPPORTED',
  'LIMIT_EXCEEDED',
  'REGISTRY_AUTH_REQUIRED',
  'REGISTRY_RATE_LIMITED',
  'REGISTRY_UNAVAILABLE',
  'PACKAGE_NOT_FOUND',
  'DEPRECATED_VERSION',
  'INVALID_REGISTRY_RESPONSE',
  'INTERNAL_SERVER_ERROR',
];
const sectionStates = [
  'pending',
  'running',
  'complete',
  'partial',
  'unavailable',
];

export class ProjectDeclarationEntity implements IDependencyDeclaration {
  @ApiProperty({
    enum: [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ],
  })
  group!: IDependencyDeclaration['group'];
  @ApiProperty()
  spec!: string;
}

export class ProjectDependencyEntity implements IProjectDependency {
  @ApiProperty()
  name!: string;
  @ApiProperty({ type: [ProjectDeclarationEntity] })
  @Type(() => ProjectDeclarationEntity)
  declarations!: ProjectDeclarationEntity[];
  @ApiProperty({
    type: [String],
    description: 'Locked versions; empty when unknown, not installed versions',
  })
  lockedVersions!: string[];
}

export class ProjectScriptEntity implements IProjectScript {
  @ApiProperty()
  name!: string;
  @ApiProperty({ description: 'Script text only; never executed' })
  command!: string;
}

export class ProjectDiskUsageEntity {
  @ApiProperty({ minimum: 0 })
  sizeBytes!: number;
  @ApiProperty({ format: 'date-time' })
  measuredAt!: string;
}

export class ProjectDetailEntity implements IProjectDetail {
  @ApiProperty({ description: 'Canonical project path' })
  path!: string;
  @ApiProperty({ description: 'Lexical requested path for links and refresh' })
  requestPath!: string;
  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
  @ApiProperty({ type: String, nullable: true })
  version!: string | null;
  @ApiProperty({ enum: ['npm', 'pnpm', 'yarn', 'unknown', 'ambiguous'] })
  manager!: IProjectDetail['manager'];
  @ApiProperty({ type: String, nullable: true })
  packageManager!: string | null;
  @ApiProperty({ type: String, nullable: true })
  lockfile!: string | null;
  @ApiProperty({ format: 'uuid' })
  scanId!: string;
  @ApiProperty()
  inputHash!: string;
  @ApiProperty({ format: 'date-time' })
  readAt!: string;
  @ApiProperty({ type: [ProjectDependencyEntity] })
  @Type(() => ProjectDependencyEntity)
  dependencies!: ProjectDependencyEntity[];
  @ApiProperty({ type: [ProjectScriptEntity] })
  @Type(() => ProjectScriptEntity)
  scripts!: ProjectScriptEntity[];
  @ApiProperty({ enum: codes, isArray: true })
  warnings!: IProjectDetail['warnings'];
  @ApiProperty({ type: ProjectDiskUsageEntity, nullable: true })
  @Type(() => ProjectDiskUsageEntity)
  diskUsage!: ProjectDiskUsageEntity | null;
}

export class ProjectOutdatedEntity implements IProjectOutdated {
  @ApiProperty()
  name!: string;
  @ApiProperty()
  registryName!: string;
  @ApiProperty({ type: [String] })
  lockedVersions!: string[];
  @ApiProperty({ type: String, nullable: true })
  wanted!: string | null;
  @ApiProperty({ type: String, nullable: true })
  latest!: string | null;
  @ApiProperty({ type: Boolean, nullable: true })
  behindWanted!: boolean | null;
  @ApiProperty({ type: Boolean, nullable: true })
  behindLatest!: boolean | null;
  @ApiProperty({ type: String, enum: [...codes, null], nullable: true })
  warning!: IProjectOutdated['warning'];
}

export class ProjectAdvisoryEntity implements IProjectAdvisory {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  url!: string | null;
  @ApiProperty({
    enum: ['info', 'low', 'moderate', 'high', 'critical', 'unknown'],
  })
  severity!: IProjectAdvisory['severity'];
  @ApiProperty()
  range!: string;
  @ApiProperty({ type: [String] })
  affectedVersions!: string[];
  @ApiProperty({
    description: 'Declared by root specs; no transitive inference',
  })
  direct!: boolean;
}

export class ProjectOutdatedSectionEntity implements IAnalysisSection<IProjectOutdated> {
  @ApiProperty({ enum: sectionStates })
  state!: IAnalysisSection<IProjectOutdated>['state'];
  @ApiProperty({ type: [ProjectOutdatedEntity] })
  @Type(() => ProjectOutdatedEntity)
  items!: ProjectOutdatedEntity[];
  @ApiProperty({ enum: codes, isArray: true })
  warningCodes!: IAnalysisSection<IProjectOutdated>['warningCodes'];
  @ApiProperty({ type: String, enum: [...codes, null], nullable: true })
  failureCode!: IAnalysisSection<IProjectOutdated>['failureCode'];
  @ApiProperty({ minimum: 0 })
  checkedCount!: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  totalCount!: number | null;
}

export class ProjectAuditSectionEntity implements IAnalysisSection<IProjectAdvisory> {
  @ApiProperty({ enum: sectionStates })
  state!: IAnalysisSection<IProjectAdvisory>['state'];
  @ApiProperty({ type: [ProjectAdvisoryEntity] })
  @Type(() => ProjectAdvisoryEntity)
  items!: ProjectAdvisoryEntity[];
  @ApiProperty({ enum: codes, isArray: true })
  warningCodes!: IAnalysisSection<IProjectAdvisory>['warningCodes'];
  @ApiProperty({ type: String, enum: [...codes, null], nullable: true })
  failureCode!: IAnalysisSection<IProjectAdvisory>['failureCode'];
  @ApiProperty({ minimum: 0 })
  checkedCount!: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  totalCount!: number | null;
}

export class ProjectAnalysisStartEntity implements IProjectAnalysisStart {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;
  @ApiProperty({
    enum: ['running', 'completed', 'cancelled', 'timed_out', 'failed'],
  })
  status!: IProjectAnalysisStart['status'];
}

export class ProjectAnalysisJobEntity
  extends ProjectAnalysisStartEntity
  implements IProjectAnalysisJob
{
  @ApiProperty()
  path!: string;
  @ApiProperty()
  requestPath!: string;
  @ApiProperty({ format: 'uuid' })
  scanId!: string;
  @ApiProperty()
  inputHash!: string;
  @ApiProperty({ enum: ['reading', 'outdated', 'audit', 'validating', 'done'] })
  phase!: IProjectAnalysisJob['phase'];
  @ApiProperty()
  partial!: boolean;
  @ApiProperty()
  stale!: boolean;
  @ApiProperty({ format: 'date-time' })
  startedAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  finishedAt!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Historical end-of-job validation time',
  })
  checkedAt!: string | null;
  @ApiProperty({ type: ProjectOutdatedSectionEntity })
  @Type(() => ProjectOutdatedSectionEntity)
  outdated!: ProjectOutdatedSectionEntity;
  @ApiProperty({ type: ProjectAuditSectionEntity })
  @Type(() => ProjectAuditSectionEntity)
  audit!: ProjectAuditSectionEntity;
  @ApiProperty({ enum: codes, isArray: true })
  warningCodes!: IProjectAnalysisJob['warningCodes'];
  @ApiProperty({ type: String, enum: [...codes, null], nullable: true })
  failureCode!: IProjectAnalysisJob['failureCode'];
}
