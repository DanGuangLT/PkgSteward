import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, ValidateBy } from 'class-validator';
import {
  hasTraversalSegment,
  isFullyQualifiedPath,
} from '@/common/utils/path.util';

export class ProjectPathQueryDto {
  @ApiProperty({
    description: 'Absolute scanned-project path without traversal or NUL bytes',
    maxLength: 32768,
  })
  @IsString({ message: 'path must be a string' })
  @IsNotEmpty({ message: 'path must not be empty' })
  @MaxLength(32768, { message: 'path must be at most 32768 characters' })
  @ValidateBy({
    name: 'isProjectAbsolutePath',
    validator: {
      validate: (value: unknown): boolean =>
        typeof value === 'string' &&
        !value.includes('\0') &&
        !hasTraversalSegment(value) &&
        (isFullyQualifiedPath(value, 'win32') ||
          isFullyQualifiedPath(value, 'posix')),
      defaultMessage: () =>
        'path must be absolute and contain no traversal or NUL bytes',
    },
  })
  path!: string;
}
