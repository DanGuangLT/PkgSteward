import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { IPmExecuteRequest } from '@/package-managers/interfaces/pm.types';

export class PmExecuteDto implements IPmExecuteRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  requestId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  previewId!: string;

  @ApiProperty({ enum: [true] })
  @Equals(true)
  confirm!: true;

  @ApiPropertyOptional({ type: [String], maxItems: 32 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  acknowledgedRisks?: string[];

  @ApiPropertyOptional({
    maxLength: 1024,
    description:
      'Reserved optional text; pin-only previews require no typed text',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(1024)
  confirmText?: string;
}
