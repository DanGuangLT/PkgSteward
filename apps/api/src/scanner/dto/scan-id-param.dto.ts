import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ScanIdParamDto {
  @ApiProperty({ description: 'Scan job UUID v4', format: 'uuid' })
  @IsUUID('4', { message: 'scanId must be a UUID v4' })
  scanId!: string;
}
