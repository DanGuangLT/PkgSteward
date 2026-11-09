import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateBy } from 'class-validator';
import type { ValidationArguments } from 'class-validator';
import { GlobalVersionsDto } from '@/global-packages/dto/global-activity.dto';
import { GLOBAL_ACTIONS } from '@/global-packages/interfaces/global-packages.types';
import type {
  GlobalAction,
  IGlobalPreviewRequest,
} from '@/global-packages/interfaces/global-packages.types';
import { isGlobalTargetVersion } from '@/global-packages/policy/global-policy';

export class GlobalPreviewDto
  extends GlobalVersionsDto
  implements IGlobalPreviewRequest
{
  @ApiProperty({ enum: [...GLOBAL_ACTIONS] })
  @IsIn([...GLOBAL_ACTIONS])
  action!: GlobalAction;

  @ApiPropertyOptional({
    maxLength: 128,
    description: 'Exact version or tag; required only for change',
  })
  @ValidateBy({
    name: 'globalTargetVersion',
    validator: {
      validate(value: unknown, args?: ValidationArguments): boolean {
        if (!args) return false;
        const body = args.object as { action?: unknown };
        if (body.action === 'change') return isGlobalTargetVersion(value);
        return (
          body.action === 'remove' && !Object.hasOwn(body, 'targetVersion')
        );
      },
    },
  })
  declare targetVersion?: string;
}
