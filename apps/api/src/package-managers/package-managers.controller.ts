import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { DangerousOperation } from '@/common/decorators/metadata';
import { PollingEndpoint } from '@/common/decorators/throttle.decorator';
import { PmProjectQueryDto } from '@/package-managers/dto/pm-project-query.dto';
import { PmVersionsDto } from '@/package-managers/dto/pm-versions.dto';
import { PmPreviewDto } from '@/package-managers/dto/pm-preview.dto';
import { PmExecuteDto } from '@/package-managers/dto/pm-execute.dto';
import { PmJobIdDto } from '@/package-managers/dto/pm-job-id.dto';
import {
  PmContextEntity,
  PmJobEntity,
  PmJobStartEntity,
} from '@/package-managers/entities/pm.entity';
import { PackageManagersService } from '@/package-managers/package-managers.service';
import type { IPackageManagersService } from '@/package-managers/interfaces/package-managers.service.interface';
import type { IPackageManagersController } from '@/package-managers/interfaces/package-managers.controller.interface';
import type {
  IPmContext,
  IPmJob,
  IPmJobStart,
} from '@/package-managers/interfaces/pm.types';

const envelope = (entity: Type, status: number, nullable = false) => ({
  type: 'object' as const,
  required: ['statusCode', 'message', 'code', 'data', 'timestamp', 'path'],
  properties: {
    statusCode: { type: 'integer' as const, example: status },
    message: { type: 'string' as const },
    code: { type: 'string' as const, example: 'SUCCESS' },
    data: nullable
      ? { allOf: [{ $ref: getSchemaPath(entity) }], nullable: true }
      : { $ref: getSchemaPath(entity) },
    timestamp: { type: 'string' as const, format: 'date-time' },
    path: { type: 'string' as const },
  },
});

@ApiTags('package-managers')
@ApiExtraModels(PmContextEntity, PmJobEntity, PmJobStartEntity)
@ApiBadRequestResponse({
  description: 'VALIDATION_ERROR: invalid input or confirmation',
})
@ApiForbiddenResponse({ description: 'FORBIDDEN: path outside allowed scope' })
@ApiNotFoundResponse({ description: 'NOT_FOUND: unknown scan, preview or job' })
@ApiConflictResponse({
  description:
    'CONFLICT: running, changed, expired or consumed; see details.reason',
})
@ApiTooManyRequestsResponse({ description: 'RATE_LIMITED' })
@ApiServiceUnavailableResponse({
  description: 'SERVICE_UNAVAILABLE: public registry or IO unavailable',
})
@Controller('package-managers')
export class PackageManagersController implements IPackageManagersController {
  constructor(
    @Inject(PackageManagersService)
    private readonly service: IPackageManagersService,
  ) {}

  @Get('project')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read fresh static project pins and installed tools without fetching versions',
  })
  @ApiOkResponse({ schema: envelope(PmContextEntity, 200) })
  async getProject(
    @Query() query: PmProjectQueryDto,
  ): Promise<IApiResponse<IPmContext>> {
    return {
      statusCode: 200,
      message: 'Package manager project retrieved successfully',
      data: plainToInstance(
        PmContextEntity,
        await this.service.getProject(query.path),
      ),
    };
  }
  @Post('versions')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Explicitly fetch versions from the public npm registry',
  })
  @ApiAcceptedResponse({ schema: envelope(PmJobStartEntity, 202) })
  async versions(
    @Body() input: PmVersionsDto,
  ): Promise<IApiResponse<IPmJobStart>> {
    return {
      statusCode: 202,
      message: 'Package manager version lookup accepted',
      data: plainToInstance(
        PmJobStartEntity,
        await this.service.versions(input),
      ),
    };
  }
  @Post('project/preview')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Preview a declaration-only package.json pin change',
  })
  @ApiAcceptedResponse({ schema: envelope(PmJobStartEntity, 202) })
  async preview(
    @Body() input: PmPreviewDto,
  ): Promise<IApiResponse<IPmJobStart>> {
    return {
      statusCode: 202,
      message: 'Package manager pin preview accepted',
      data: plainToInstance(
        PmJobStartEntity,
        await this.service.preview(input),
      ),
    };
  }
  @Post('project/execute')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @DangerousOperation()
  @ApiOperation({
    summary:
      'Confirm one project pin edit after fresh preflight; no install or activation',
  })
  @ApiAcceptedResponse({ schema: envelope(PmJobStartEntity, 202) })
  async execute(
    @Body() input: PmExecuteDto,
  ): Promise<IApiResponse<IPmJobStart>> {
    const accepted = await this.service.execute(input);
    await this.service.waitForPreflight(accepted.jobId);
    return {
      statusCode: 202,
      message: 'Package manager pin change accepted',
      data: plainToInstance(PmJobStartEntity, accepted),
    };
  }
  @Get('jobs/latest')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Poll the latest retained job, or null before admission',
  })
  @ApiOkResponse({ schema: envelope(PmJobEntity, 200, true) })
  getLatest(): IApiResponse<IPmJob | null> {
    const job = this.service.getLatest();
    return {
      statusCode: 200,
      message: 'Latest package manager job retrieved successfully',
      data: job === null ? null : plainToInstance(PmJobEntity, job),
    };
  }
  @Get('jobs/:id')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Poll one retained no-process job without IO' })
  @ApiOkResponse({ schema: envelope(PmJobEntity, 200) })
  getJob(@Param() params: PmJobIdDto): IApiResponse<IPmJob> {
    return {
      statusCode: 200,
      message: 'Package manager job retrieved successfully',
      data: plainToInstance(PmJobEntity, this.service.getJob(params.id)),
    };
  }
  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @DangerousOperation()
  @ApiOperation({
    summary: 'Request cancel or retry cleanup without repeating the pin write',
  })
  @ApiOkResponse({ schema: envelope(PmJobEntity, 200) })
  async cancel(@Param() params: PmJobIdDto): Promise<IApiResponse<IPmJob>> {
    return {
      statusCode: 200,
      message: 'Package manager cancellation processed',
      data: plainToInstance(PmJobEntity, await this.service.cancel(params.id)),
    };
  }
}
