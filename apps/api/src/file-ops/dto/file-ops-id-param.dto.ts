import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PreviewIdParamDto {
  @ApiProperty({ description: 'Preview UUID v4', format: 'uuid' })
  @IsUUID('4', { message: 'previewId must be a UUID v4' })
  previewId!: string;
}

export class OperationIdParamDto {
  @ApiProperty({ description: 'Operation UUID v4', format: 'uuid' })
  @IsUUID('4', { message: 'operationId must be a UUID v4' })
  operationId!: string;
}
