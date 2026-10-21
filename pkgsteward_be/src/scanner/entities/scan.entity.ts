import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type {
  IOrphanNodeModules,
  IScanJob,
  IScannedProject,
  IScanProgress,
  IScanResult,
  IScanStart,
  PackageManager,
  ScanStatus,
} from '@/scanner/interfaces/scanner.types';

const statuses: ScanStatus[] = [
  'running',
  'completed',
  'cancelled',
  'timed_out',
  'failed',
];

export class ScanStartEntity implements IScanStart {
  @ApiProperty({ format: 'uuid' })
  scanId!: string;

  @ApiProperty({ enum: statuses })
  status!: ScanStatus;
}

export class ScanProgressEntity implements IScanProgress {
  @ApiProperty({ minimum: 0 })
  visitedDirs!: number;

  @ApiProperty({ minimum: 0 })
  foundProjects!: number;

  @ApiProperty({ minimum: 0 })
  skippedCount!: number;
}

type NodeModules = IScannedProject['nodeModules'];

export class NodeModulesEntity implements NodeModules {
  @ApiProperty()
  exists!: boolean;

  @ApiProperty({
    description: 'Candidate node_modules path, including when absent',
  })
  path!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    enum: [null],
    description: 'Always null; scanning does not calculate disk usage',
  })
  sizeBytes!: null;
}

export class ScannedProjectEntity implements IScannedProject {
  @ApiProperty()
  path!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({
    type: String,
    enum: ['pnpm', 'yarn', 'npm', null],
    nullable: true,
  })
  packageManager!: PackageManager | null;

  @ApiProperty()
  hasLockfile!: boolean;

  @ApiProperty({ format: 'date-time' })
  lastActivityAt!: string;

  @ApiProperty({ type: NodeModulesEntity })
  @Type(() => NodeModulesEntity)
  nodeModules!: NodeModulesEntity;
}

export class OrphanNodeModulesEntity implements IOrphanNodeModules {
  @ApiProperty()
  path!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    enum: [null],
    description: 'Always null; scanning does not calculate disk usage',
  })
  sizeBytes!: null;

  @ApiProperty({ format: 'date-time' })
  mtime!: string;
}

export class ScanJobEntity extends ScanStartEntity implements IScanJob {
  @ApiProperty({ description: 'True for cancelled, timed_out or failed jobs' })
  partial!: boolean;

  @ApiProperty({ type: ScanProgressEntity })
  @Type(() => ScanProgressEntity)
  progress!: ScanProgressEntity;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  finishedAt?: string;
}

export class ScanResultEntity extends ScanStartEntity implements IScanResult {
  @ApiProperty({ enum: ['completed', 'timed_out'] })
  declare status: 'completed' | 'timed_out';

  @ApiProperty({ description: 'True when the scan timed out' })
  partial!: boolean;

  @ApiProperty({
    type: [String],
    description: 'Canonical roots successfully read',
  })
  roots!: string[];

  @ApiProperty({ minimum: 0, description: 'Zero means unlimited depth' })
  maxDepth!: number;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ format: 'date-time' })
  finishedAt!: string;

  @ApiProperty({ minimum: 0 })
  skippedCount!: number;

  @ApiProperty({ type: [ScannedProjectEntity] })
  @Type(() => ScannedProjectEntity)
  projects!: ScannedProjectEntity[];

  @ApiProperty({ type: [OrphanNodeModulesEntity] })
  @Type(() => OrphanNodeModulesEntity)
  orphanNodeModules!: OrphanNodeModulesEntity[];
}
