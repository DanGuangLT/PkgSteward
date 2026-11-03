import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type {
  DiskStatus,
  DiskStop,
  DiskView,
  IDiskUsageJob,
  IDiskUsageProgress,
  IDiskUsageRow,
  IDiskUsageStart,
} from '@/disk-usage/interfaces/disk-usage.types';

export class DiskUsageStartEntity implements IDiskUsageStart {
  @ApiProperty({ format: 'uuid' })
  jobId!: string;

  @ApiProperty({
    enum: ['running', 'completed', 'cancelled', 'timed_out', 'failed'],
  })
  status!: DiskStatus;
}

export class DiskUsageProgressEntity implements IDiskUsageProgress {
  @ApiProperty({ minimum: 0 })
  visitedDirs!: number;
  @ApiProperty({ minimum: 0 })
  visitedEntries!: number;
  @ApiProperty({ minimum: 0 })
  skippedCount!: number;
  @ApiProperty({ minimum: 0 })
  skippedLinks!: number;
}

export class DiskUsageRowEntity implements IDiskUsageRow {
  @ApiProperty()
  path!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ enum: ['file', 'directory', 'link', 'package'] })
  kind!: IDiskUsageRow['kind'];
  @ApiProperty({ type: String, nullable: true })
  canonicalPath!: string | null;
  @ApiProperty({ type: [String] })
  aliases!: string[];
  @ApiProperty({
    enum: ['pending', 'measuring', 'complete', 'partial', 'excluded'],
  })
  state!: IDiskUsageRow['state'];
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  sizeBytes!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  fileCount!: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: [
      'protected',
      'link_skipped',
      'outside_root',
      'unreadable',
      'unsupported',
      'identity_unavailable',
      null,
    ],
  })
  reason!: IDiskUsageRow['reason'];
}

export class DiskUsageJobEntity
  extends DiskUsageStartEntity
  implements IDiskUsageJob
{
  @ApiProperty()
  path!: string;
  @ApiProperty({ enum: ['directory', 'packages'] })
  view!: DiskView;
  @ApiProperty({ enum: ['unique-apparent'] })
  metric!: 'unique-apparent';
  @ApiProperty({ enum: ['listing', 'measuring'] })
  phase!: 'listing' | 'measuring';
  @ApiProperty()
  partial!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['cancelled', 'row_limit', 'identity_limit', 'numeric_limit', null],
  })
  stopReason!: DiskStop;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  sizeBytes!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  fileCount!: number | null;
  @ApiProperty({ type: [DiskUsageRowEntity] })
  @Type(() => DiskUsageRowEntity)
  children!: DiskUsageRowEntity[];
  @ApiProperty({ type: DiskUsageProgressEntity })
  @Type(() => DiskUsageProgressEntity)
  progress!: DiskUsageProgressEntity;
  @ApiProperty({ format: 'date-time' })
  startedAt!: string;
  @ApiPropertyOptional({ format: 'date-time' })
  finishedAt?: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  measuredAt!: string | null;
  @ApiProperty()
  cacheHit!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['NOT_FOUND', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR', null],
  })
  failureCode!: IDiskUsageJob['failureCode'];
}
