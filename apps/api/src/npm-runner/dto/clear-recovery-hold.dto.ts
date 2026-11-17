import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

export class ClearRecoveryHoldDto {
  @ApiProperty({
    description:
      'Explicit owner confirmation after verifying abandoned native console state',
    example: true,
  })
  @IsBoolean({ message: 'confirm must be true' })
  @Equals(true, { message: 'confirm must be true' })
  confirm!: true;
}
