import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_PATH_LENGTH } from '@/file-ops/dto/delete-preview.dto';

export class TreeQueryDto {
  @ApiProperty({
    maxLength: MAX_PATH_LENGTH,
    description: 'A scanned project root or a directory inside it',
  })
  @IsString({ message: 'path must be a string' })
  @IsNotEmpty({ message: 'path must not be empty' })
  @MaxLength(MAX_PATH_LENGTH, {
    message: `path must be at most ${MAX_PATH_LENGTH} characters`,
  })
  path!: string;
}
