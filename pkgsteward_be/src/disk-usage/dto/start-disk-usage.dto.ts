import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type {
  DiskView,
  IStartDiskUsage,
} from '@/disk-usage/interfaces/disk-usage.types';

export class StartDiskUsageDto implements IStartDiskUsage {
  @ApiProperty({
    maxLength: 32768,
    description: 'Absolute directory path to measure',
  })
  @IsString({ message: 'path must be a string' })
  @IsNotEmpty({ message: 'path must not be empty' })
  @MaxLength(32768, { message: 'path must be at most 32768 characters' })
  path!: string;

  @ApiPropertyOptional({
    enum: ['directory', 'packages'],
    default: 'directory',
  })
  @IsOptional()
  @IsIn(['directory', 'packages'], {
    message: 'view must be directory or packages',
  })
  view?: DiskView;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @IsBoolean({ message: 'force must be a boolean' })
  force?: boolean;
}
