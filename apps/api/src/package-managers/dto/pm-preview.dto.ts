import { ApiProperty } from '@nestjs/swagger';
import { IsIn, ValidateBy } from 'class-validator';
import { PmVersionsDto } from '@/package-managers/dto/pm-versions.dto';
import { PM_WRITABLE_MANAGERS } from '@/package-managers/interfaces/pm.types';
import type {
  IPmPreviewRequest,
  PmWritableManager,
} from '@/package-managers/interfaces/pm.types';
import { isPmTargetVersion } from '@/package-managers/pinning/pm-policy';

export class PmPreviewDto extends PmVersionsDto implements IPmPreviewRequest {
  @ApiProperty({ enum: [...PM_WRITABLE_MANAGERS] })
  @IsIn([...PM_WRITABLE_MANAGERS])
  declare manager: PmWritableManager;

  @ApiProperty({
    maxLength: 128,
    description:
      'Canonical exact version or public tag; fresh stable-major policy applies on server',
  })
  @ValidateBy({
    name: 'pmTargetVersion',
    validator: { validate: isPmTargetVersion },
  })
  targetVersion!: string;
}
