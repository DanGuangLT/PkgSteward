import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID, Length, ValidateBy } from 'class-validator';
import { GLOBAL_MANAGERS } from '@/global-packages/interfaces/global-packages.types';
import type {
  GlobalManager,
  IGlobalActivityRequest,
  IGlobalVersionsRequest,
} from '@/global-packages/interfaces/global-packages.types';
import { isGlobalPackageName } from '@/global-packages/global-policy';

export class GlobalActivityDto implements IGlobalActivityRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Length(36, 36)
  requestId!: string;
}
export class GlobalVersionsDto
  extends GlobalActivityDto
  implements IGlobalVersionsRequest
{
  @ApiProperty({ enum: [...GLOBAL_MANAGERS] })
  @IsIn([...GLOBAL_MANAGERS])
  manager!: GlobalManager;

  @ApiProperty({ maxLength: 214, description: 'Registry package name only' })
  @ValidateBy({
    name: 'globalPackageName',
    validator: { validate: isGlobalPackageName },
  })
  package!: string;
}
