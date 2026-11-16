import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { RunnerPathQueryDto } from '@/npm-runner/dto/runner-path-query.dto';
import { RUN_ACTIONS } from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunRequest,
  RunAction,
} from '@/npm-runner/interfaces/npm-runner.types';
import { TERMINAL_LIMITS } from '@/npm-runner/terminal/terminal-protocol';

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
  @ApiPropertyOptional({
    type: Boolean,
    description: 'Run command inside an interactive ConPTY terminal session',
  })
  @IsOptional()
  @IsBoolean()
  terminal?: boolean;
  @ApiPropertyOptional({
    type: Number,
    minimum: TERMINAL_LIMITS.colsMin,
    maximum: TERMINAL_LIMITS.colsMax,
  })
  @IsOptional()
  @IsInt()
  @Min(TERMINAL_LIMITS.colsMin)
  @Max(TERMINAL_LIMITS.colsMax)
  cols?: number;
  @ApiPropertyOptional({
    type: Number,
    minimum: TERMINAL_LIMITS.rowsMin,
    maximum: TERMINAL_LIMITS.rowsMax,
  })
  @IsOptional()
  @IsInt()
  @Min(TERMINAL_LIMITS.rowsMin)
  @Max(TERMINAL_LIMITS.rowsMax)
  rows?: number;
}
