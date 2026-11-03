import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsUUID, Length, Matches, ValidateBy } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { RunnerPathQueryDto } from './runner-path-query.dto';
import { RUN_ACTIONS } from '../interfaces/npm-runner.types';
import type { IRunRequest, RunAction } from '../interfaces/npm-runner.types';

const actionField = (
  field: 'package' | 'script',
  actions: readonly string[],
) => ({
  validate(value: unknown, args?: ValidationArguments): boolean {
    if (!args) return false;
    const body = args.object as { action?: unknown };
    return typeof body.action === 'string' && actions.includes(body.action)
      ? typeof value === 'string' && value.length > 0
      : !Object.hasOwn(body, field);
  },
});
export class StartNpmRunDto extends RunnerPathQueryDto implements IRunRequest {
  @ApiProperty({ enum: [...RUN_ACTIONS] })
  @IsIn([...RUN_ACTIONS])
  action!: RunAction;
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  @Matches(/^[a-f0-9]{64}$/)
  @Length(64, 64)
  inputHash!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  requestId!: string;
  @ApiPropertyOptional({
    description: 'Required only for install_one/update_one/uninstall_one',
  })
  @ValidateBy({
    name: 'runnerPackageField',
    validator: actionField('package', [
      'install_one',
      'update_one',
      'uninstall_one',
    ]),
  })
  declare package?: string;
  @ApiPropertyOptional({ description: 'Required only for script' })
  @ValidateBy({
    name: 'runnerScriptField',
    validator: actionField('script', ['script']),
  })
  declare script?: string;
}
