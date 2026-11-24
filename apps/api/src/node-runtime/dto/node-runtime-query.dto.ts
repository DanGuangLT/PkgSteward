import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import {
  hasTraversalSegment,
  isFullyQualifiedPath,
} from '@/common/utils/path.util';

export class GetNodeRuntimeOverviewQueryDto {
  @ApiPropertyOptional({
    description: 'Bypass the 30-second manager probe cache when true',
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'refresh must be a boolean' })
  refresh?: boolean;
}

export class GetProjectNodeRuntimeQueryDto {
  @ApiProperty({
    description: 'Absolute project path without traversal or NUL bytes',
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
