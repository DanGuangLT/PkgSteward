import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export const MAX_PATH_LENGTH = 32767;
export const MAX_PATHS = 1000;

export class DeletePreviewDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: MAX_PATHS,
    description: 'Absolute paths inside scanned projects',
  })
  @IsArray({ message: 'paths must be an array' })
  @ArrayNotEmpty({ message: 'paths must not be empty' })
  @ArrayMaxSize(MAX_PATHS, {
    message: `paths must contain at most ${MAX_PATHS} items`,
  })
  @IsString({ each: true, message: 'each path must be a string' })
  @IsNotEmpty({ each: true, message: 'each path must not be empty' })
  @MaxLength(MAX_PATH_LENGTH, {
    each: true,
    message: `each path must be at most ${MAX_PATH_LENGTH} characters`,
  })
  paths!: string[];
}
