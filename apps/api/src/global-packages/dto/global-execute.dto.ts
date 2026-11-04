import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { GlobalActivityDto } from '@/global-packages/dto/global-activity.dto';
import type { IGlobalExecuteRequest } from '@/global-packages/interfaces/global-packages.types';

export class GlobalExecuteDto
  extends GlobalActivityDto
  implements IGlobalExecuteRequest
{
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  previewId!: string;

  @ApiProperty({ enum: [true] })
  @Equals(true)
  confirm!: true;

  @ApiProperty({ type: [String], maxItems: 32 })
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  acknowledgedRisks!: string[];

  @ApiProperty({ maxLength: 1024 })
  @IsString()
  @MaxLength(1024)
  confirmText!: string;
}
