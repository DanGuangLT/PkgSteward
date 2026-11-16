import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';
import type {
  ITerminalClaimBody,
  ITerminalInputAckBody,
  ITerminalInputBody,
  ITerminalResizeBody,
  ITerminalWriterBody,
} from '@/npm-runner/interfaces/npm-runner.types';
import { TERMINAL_LIMITS } from '@/npm-runner/terminal/terminal-protocol';

const safeQueryInt = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' &&
  value.trim() === value &&
  /^(?:0|[1-9]\d*)$/.test(value) &&
  value.length <= 16
    ? Number(value)
    : value;

export class TerminalOutputQueryDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @Transform(safeQueryInt)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  generation!: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
  })
  @Transform(safeQueryInt)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  cursor = 0;
}

export class TerminalClaimDto implements ITerminalClaimBody {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  requestId!: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  generation!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  tabId!: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  takeover!: boolean;
}

export class TerminalWriterDto implements ITerminalWriterBody {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  requestId!: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  generation!: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  tabId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  token!: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  writerGeneration!: number;
}

export class TerminalInputAckDto
  extends TerminalWriterDto
  implements ITerminalInputAckBody
{
  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  sequence!: number;
}

export class TerminalInputDto
  extends TerminalInputAckDto
  implements ITerminalInputBody
{
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: TERMINAL_LIMITS.inputBytes,
  })
  @IsString()
  @IsNotEmpty()
  @ValidateBy({
    name: 'terminalInputText',
    validator: {
      validate(value: unknown): boolean {
        return (
          typeof value === 'string' &&
          value.length > 0 &&
          value.length <= TERMINAL_LIMITS.inputBytes &&
          Buffer.byteLength(value, 'utf8') <= TERMINAL_LIMITS.inputBytes &&
          Buffer.from(value, 'utf8').toString('utf8') === value
        );
      },
      defaultMessage(): string {
        return `text must be nonempty well-formed UTF-8 within ${TERMINAL_LIMITS.inputBytes} bytes`;
      },
    },
  })
  text!: string;
}

export class TerminalResizeDto
  extends TerminalWriterDto
  implements ITerminalResizeBody
{
  @ApiProperty({
    type: Number,
    minimum: TERMINAL_LIMITS.colsMin,
    maximum: TERMINAL_LIMITS.colsMax,
  })
  @IsInt()
  @Min(TERMINAL_LIMITS.colsMin)
  @Max(TERMINAL_LIMITS.colsMax)
  cols!: number;

  @ApiProperty({
    type: Number,
    minimum: TERMINAL_LIMITS.rowsMin,
    maximum: TERMINAL_LIMITS.rowsMax,
  })
  @IsInt()
  @Min(TERMINAL_LIMITS.rowsMin)
  @Max(TERMINAL_LIMITS.rowsMax)
  rows!: number;
}
