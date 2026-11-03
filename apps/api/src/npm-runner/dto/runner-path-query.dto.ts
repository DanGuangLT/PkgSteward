import { ApiProperty } from '@nestjs/swagger';
import { ValidateBy } from 'class-validator';
import {
  hasTraversalSegment,
  isFullyQualifiedPath,
} from '@/common/utils/path.util';

export const isRunnerPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 32767 &&
  !value.includes('\0') &&
  !value.includes('\r') &&
  !value.includes('\n') &&
  !hasTraversalSegment(value) &&
  isFullyQualifiedPath(value, 'win32');

export class RunnerPathQueryDto {
  @ApiProperty({
    description: 'Fully qualified local scanned-project path',
    maxLength: 32767,
  })
  @ValidateBy({ name: 'runnerPath', validator: { validate: isRunnerPath } })
  path!: string;
}
