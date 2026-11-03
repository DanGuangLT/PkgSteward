import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  RUN_ACTIONS,
  RUN_FAILURE_CODES,
  RUN_STATUSES,
  RUN_WARNING_CODES,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRunJob,
  IRunLogChunk,
  IRunLogPage,
  IRunStart,
  IRunnerContext,
  IRunnerScript,
} from '@/npm-runner/interfaces/npm-runner.types';

export class RunnerScriptEntity implements IRunnerScript {
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Inert declared script text' }) command!: string;
  @ApiProperty() eligible!: boolean;
}
export class RunnerContextEntity implements IRunnerContext {
  @ApiProperty() requestPath!: string;
  @ApiProperty() path!: string;
  @ApiProperty({ format: 'uuid' }) scanId!: string;
  @ApiProperty() inputHash!: string;
  @ApiProperty({ enum: ['npm', 'pnpm', 'yarn', 'unknown', 'ambiguous'] })
  manager!: IRunnerContext['manager'];
  @ApiProperty({ type: String, nullable: true }) version!: string | null;
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: String, enum: [...RUN_FAILURE_CODES], nullable: true })
  reason!: IRunnerContext['reason'];
  @ApiProperty({ type: [RunnerScriptEntity] })
  @Type(() => RunnerScriptEntity)
  scripts!: RunnerScriptEntity[];
  @ApiProperty({ enum: [...RUN_WARNING_CODES], isArray: true })
  warnings!: IRunnerContext['warnings'];
}
export class RunStartEntity implements IRunStart {
  @ApiProperty({ format: 'uuid' }) jobId!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ enum: [...RUN_STATUSES] }) status!: IRunStart['status'];
}
export class RunJobEntity extends RunStartEntity implements IRunJob {
  @ApiProperty() requestPath!: string;
  @ApiProperty() path!: string;
  @ApiProperty({ format: 'uuid' }) scanId!: string;
  @ApiProperty({ enum: [...RUN_ACTIONS] }) action!: IRunJob['action'];
  @ApiProperty({ enum: ['npm', 'pnpm', 'yarn', 'unknown', 'ambiguous'] })
  manager!: IRunJob['manager'];
  @ApiProperty({ type: String, nullable: true }) version!: string | null;
  @ApiProperty({ type: String, nullable: true }) package!: string | null;
  @ApiProperty({ type: String, nullable: true }) script!: string | null;
  @ApiProperty({
    enum: ['preflight', 'executing', 'stopping', 'finalizing', 'done'],
  })
  phase!: IRunJob['phase'];
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  finishedAt!: string | null;
  @ApiProperty() spawned!: boolean;
  @ApiProperty({ type: Number, nullable: true }) exitCode!: number | null;
  @ApiProperty({ type: String, nullable: true }) signal!: string | null;
  @ApiProperty({ type: String, enum: [...RUN_FAILURE_CODES], nullable: true })
  failureCode!: IRunJob['failureCode'];
  @ApiProperty({
    type: String,
    enum: ['cancel', 'timeout', 'shutdown'],
    nullable: true,
  })
  stopReason!: IRunJob['stopReason'];
  @ApiProperty() terminationVerified!: boolean;
  @ApiProperty() mayHaveChanged!: boolean;
  @ApiProperty() gateHeld!: boolean;
  @ApiProperty() auditWritten!: boolean;
  @ApiProperty() refreshRequired!: boolean;
  @ApiProperty({ enum: [...RUN_WARNING_CODES], isArray: true })
  warningCodes!: IRunJob['warningCodes'];
  @ApiProperty({ minimum: 0 }) firstCursor!: number;
  @ApiProperty({ minimum: 0 }) endCursor!: number;
  @ApiProperty({ minimum: 0 }) droppedBytes!: number;
}
export class RunLogChunkEntity implements IRunLogChunk {
  @ApiProperty({ minimum: 0 }) seq!: number;
  @ApiProperty({ enum: ['stdout', 'stderr'] }) stream!: IRunLogChunk['stream'];
  @ApiProperty() text!: string;
}
export class RunLogPageEntity implements IRunLogPage {
  @ApiProperty({ format: 'uuid' }) jobId!: string;
  @ApiProperty({ minimum: 0 }) firstCursor!: number;
  @ApiProperty({ minimum: 0 }) nextCursor!: number;
  @ApiProperty({ minimum: 0 }) endCursor!: number;
  @ApiProperty() truncated!: boolean;
  @ApiProperty({ minimum: 0 }) droppedBytes!: number;
  @ApiProperty({ type: [RunLogChunkEntity] })
  @Type(() => RunLogChunkEntity)
  chunks!: RunLogChunkEntity[];
}
