import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
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
  // Không dùng IsOptional: nó bỏ qua cả null; chỉ field không gửi mới lấy mặc định.
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['directory', 'packages'], {
    message: 'view must be directory or packages',
  })
  view?: DiskView;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: 'force must be a boolean' })
  force?: boolean;
}
