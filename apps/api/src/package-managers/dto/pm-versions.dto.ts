import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID, Length } from 'class-validator';
import { PmProjectQueryDto } from '@/package-managers/dto/pm-project-query.dto';
import { PM_MANAGERS } from '@/package-managers/interfaces/pm.types';
import type {
  IPmVersionsRequest,
  PmManager,
} from '@/package-managers/interfaces/pm.types';

export class PmVersionsDto
  extends PmProjectQueryDto
  implements IPmVersionsRequest
{
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  requestId!: string;

  @ApiProperty({
    enum: [...PM_MANAGERS],
    description: 'Public npm registry catalog; Yarn Classic is read-only',
  })
  @IsIn([...PM_MANAGERS])
  manager!: PmManager;
}
