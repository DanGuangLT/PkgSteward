import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DiskUsageIdParamDto {
  @ApiProperty({ description: 'Measurement job UUID v4', format: 'uuid' })
  @IsUUID('4', { message: 'jobId must be a UUID v4' })
  jobId!: string;
}
