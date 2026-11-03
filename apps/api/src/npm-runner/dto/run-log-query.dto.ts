import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class RunLogQueryDto {
  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' &&
    value.trim() === value &&
    /^(?:0|[1-9]\d*)$/.test(value) &&
    value.length <= 16
      ? Number(value)
      : value,
  )
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  cursor = 0;
}
