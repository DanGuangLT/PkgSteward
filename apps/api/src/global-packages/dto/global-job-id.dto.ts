import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Length } from 'class-validator';

export class GlobalJobIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  id!: string;
}
