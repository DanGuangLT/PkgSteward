import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  RUN_ACTIONS,
  RUN_FAILURE_CODES,
  RUN_STATUSES,
  RUN_WARNING_CODES,
  CONSOLE_SHELLS,
  NATIVE_SESSION_PHASES,
} from '@/npm-runner/interfaces/npm-runner.types';
import type {
  IRecoveryClearResult,
  IRunJob,
  IRunLatestHold,
  IRunLogChunk,
  IRunLogPage,
  IRunStart,
  IRunnerContext,
  IRunnerScript,
  INativeConsoleMeta,
  IRunCommandResult,
  IRunRecoveryHold,
} from '@/npm-runner/interfaces/npm-runner.types';

export class RunnerScriptEntity implements IRunnerScript {
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Inert declared script text' }) command!: string;
  @ApiProperty() eligible!: boolean;
}
export class RunCommandResultEntity implements IRunCommandResult {
  @ApiProperty({ type: Number, nullable: true }) exitCode!: number | null;
  @ApiProperty({ type: String, nullable: true }) signal!: string | null;
}
export class RunRecoveryHoldEntity implements IRunRecoveryHold {
  @ApiProperty() active!: boolean;
  @ApiProperty() reason!: string;
  @ApiProperty() journalPath!: string;
}
export class RunLatestHoldEntity implements IRunLatestHold {
  @ApiProperty({ type: () => RunRecoveryHoldEntity })
  @Type(() => RunRecoveryHoldEntity)
  recoveryHold!: RunRecoveryHoldEntity;
  @ApiProperty({ type: () => RunJobEntity, nullable: true })
  job!: null;
}
export class RecoveryClearResultEntity implements IRecoveryClearResult {
  @ApiProperty() cleared!: boolean;
  @ApiProperty({ type: () => RunRecoveryHoldEntity, nullable: true })
  @Type(() => RunRecoveryHoldEntity)
  recoveryHold!: RunRecoveryHoldEntity | null;
}
export class NativeSessionMetaEntity implements INativeConsoleMeta {
  @ApiProperty({ enum: [...CONSOLE_SHELLS] })
  shell!: INativeConsoleMeta['shell'];
  @ApiProperty({ minimum: 1 }) generation!: number;
  @ApiProperty({ enum: [...NATIVE_SESSION_PHASES] })
  phase!: INativeConsoleMeta['phase'];
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: () => RunCommandResultEntity, nullable: true })
  @Type(() => RunCommandResultEntity)
  sessionResult!: RunCommandResultEntity | null;
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
  @ApiPropertyOptional({ type: Boolean })
  nativeConsoleAvailable?: boolean;
  @ApiPropertyOptional({ type: () => RunRecoveryHoldEntity, nullable: true })
  @Type(() => RunRecoveryHoldEntity)
  recoveryHold?: RunRecoveryHoldEntity | null;
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
  @ApiPropertyOptional({ type: () => NativeSessionMetaEntity, nullable: true })
  @Type(() => NativeSessionMetaEntity)
  nativeSession?: NativeSessionMetaEntity | null;
  @ApiPropertyOptional({ type: () => RunCommandResultEntity, nullable: true })
  @Type(() => RunCommandResultEntity)
  initialCommand?: RunCommandResultEntity | null;
  @ApiPropertyOptional({ type: () => RunRecoveryHoldEntity, nullable: true })
  @Type(() => RunRecoveryHoldEntity)
  recoveryHold?: RunRecoveryHoldEntity | null;
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
