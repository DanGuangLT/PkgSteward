import { ApiProperty } from '@nestjs/swagger';
import { ValidateBy } from 'class-validator';
import { isRunnerPath } from '@/npm-runner/dto/runner-path-query.dto';
import type { IPmProjectRequest } from '@/package-managers/interfaces/pm.types';

export class PmProjectQueryDto implements IPmProjectRequest {
  @ApiProperty({
    description: 'Fully qualified scanned project root',
    maxLength: 32767,
  })
  @ValidateBy({ name: 'pmProjectPath', validator: { validate: isRunnerPath } })
  path!: string;
}
