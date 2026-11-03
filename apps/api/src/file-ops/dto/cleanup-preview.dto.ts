import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_PATH_LENGTH, MAX_PATHS } from '@/file-ops/dto/delete-preview.dto';
import type {
  CleanupKind,
  ICleanupPreviewInput,
} from '@/file-ops/interfaces/file-ops.types';

const CLEANUP_KINDS: readonly CleanupKind[] = [
  'node_modules',
  'orphan_node_modules',
  'build_cache',
];

// Không dùng IsOptional: nó bỏ qua cả null; chỉ field không gửi mới lấy mặc định.
export class CleanupPreviewDto implements ICleanupPreviewInput {
  @ApiPropertyOptional({ enum: CLEANUP_KINDS, isArray: true, minItems: 1 })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray({ message: 'includeKinds must be an array' })
  @ArrayNotEmpty({ message: 'includeKinds must not be empty' })
  @IsIn(CLEANUP_KINDS, {
    each: true,
    message: 'each kind must be a known cleanup kind',
  })
  includeKinds?: CleanupKind[];

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Only projects inactive for at least this many days',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt({ message: 'olderThanDays must be an integer' })
  @Min(0, { message: 'olderThanDays must not be negative' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'olderThanDays is too large' })
  olderThanDays?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Drop measured targets smaller than this',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt({ message: 'minSizeBytes must be an integer' })
  @Min(0, { message: 'minSizeBytes must not be negative' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'minSizeBytes is too large' })
  minSizeBytes?: number;

  @ApiPropertyOptional({
    type: [String],
    minItems: 1,
    maxItems: MAX_PATHS,
    description: 'Limit the cleanup to these scanned projects',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray({ message: 'projectPaths must be an array' })
  @ArrayNotEmpty({ message: 'projectPaths must not be empty' })
  @ArrayMaxSize(MAX_PATHS, {
    message: `projectPaths must contain at most ${MAX_PATHS} items`,
  })
  @IsString({ each: true, message: 'each project path must be a string' })
  @IsNotEmpty({ each: true, message: 'each project path must not be empty' })
  @MaxLength(MAX_PATH_LENGTH, {
    each: true,
    message: `each project path must be at most ${MAX_PATH_LENGTH} characters`,
  })
  projectPaths?: string[];
}
