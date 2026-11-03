import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DeletePreviewDto } from '@/file-ops/dto/delete-preview.dto';
import type { IExecuteInput } from '@/file-ops/interfaces/file-ops.types';

export const MAX_ACKNOWLEDGED_RISKS = 32;
export const MAX_CONFIRM_TEXT_LENGTH = 1024;

export class DeleteExecuteDto
  extends DeletePreviewDto
  implements IExecuteInput
{
  @ApiProperty({ description: 'Preview UUID v4', format: 'uuid' })
  @IsUUID('4', { message: 'previewId must be a UUID v4' })
  previewId!: string;

  @ApiProperty({ enum: [true], description: 'Must be the boolean true' })
  @Equals(true, { message: 'confirm must be true' })
  confirm!: true;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_ACKNOWLEDGED_RISKS,
    description: 'Every risk code of a medium or high risk selection',
  })
  // Không dùng IsOptional: nó bỏ qua cả null; chỉ field không gửi mới được thiếu.
  @ValidateIf((_, value) => value !== undefined)
  @IsArray({ message: 'acknowledgedRisks must be an array' })
  @ArrayMaxSize(MAX_ACKNOWLEDGED_RISKS, {
    message: `acknowledgedRisks must contain at most ${MAX_ACKNOWLEDGED_RISKS} items`,
  })
  @IsString({ each: true, message: 'each risk code must be a string' })
  acknowledgedRisks?: string[];

  @ApiPropertyOptional({
    maxLength: MAX_CONFIRM_TEXT_LENGTH,
    description: 'The exact confirmation text of a high risk selection',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: 'confirmText must be a string' })
  @MaxLength(MAX_CONFIRM_TEXT_LENGTH, {
    message: `confirmText must be at most ${MAX_CONFIRM_TEXT_LENGTH} characters`,
  })
  confirmText?: string;
}
