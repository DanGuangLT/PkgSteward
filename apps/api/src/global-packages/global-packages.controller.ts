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
import {
  GlobalActivityDto,
  GlobalVersionsDto,
} from '@/global-packages/dto/global-activity.dto';
import { GlobalExecuteDto } from '@/global-packages/dto/global-execute.dto';
import { GlobalJobIdDto } from '@/global-packages/dto/global-job-id.dto';
import { GlobalLogQueryDto } from '@/global-packages/dto/global-log-query.dto';
import { GlobalPreviewDto } from '@/global-packages/dto/global-preview.dto';
import type { IGlobalPackagesHttpController } from '@/global-packages/interfaces/global-packages.controller.interface';
import type { IGlobalPackagesService } from '@/global-packages/interfaces/global-packages.service.interface';
import type {
  IGlobalJob,
  IGlobalJobStart,
  IGlobalLogPage,
  IGlobalSnapshot,
} from '@/global-packages/interfaces/global-packages.types';
import { GlobalPackagesService } from '@/global-packages/global-packages.service';
import {
  GlobalJobEntity,
  GlobalJobStartEntity,
  GlobalLogPageEntity,
  GlobalSnapshotEntity,
} from '@/global-packages/entities/global-packages.entity';

const envelope = (entity: Type, statusCode: number, nullable = false) => ({
  type: 'object' as const,
  required: ['statusCode', 'message', 'code', 'data', 'timestamp', 'path'],
  properties: {
    statusCode: { type: 'integer' as const, example: statusCode },
    message: { type: 'string' as const },
    code: { type: 'string' as const, example: 'SUCCESS' },
    data: nullable
      ? { allOf: [{ $ref: getSchemaPath(entity) }], nullable: true }
      : { $ref: getSchemaPath(entity) },
    timestamp: { type: 'string' as const, format: 'date-time' },
    path: { type: 'string' as const },
  },
});

@ApiTags('global-packages')
@ApiExtraModels(
  GlobalSnapshotEntity,
  GlobalJobStartEntity,
  GlobalJobEntity,
  GlobalLogPageEntity,
)
@ApiBadRequestResponse({
  description: 'VALIDATION_ERROR: invalid input or consent',
})
@ApiForbiddenResponse({ description: 'FORBIDDEN: unsafe or protected package' })
@ApiNotFoundResponse({ description: 'NOT_FOUND: unknown preview or job' })
@ApiConflictResponse({
  description:
    'CONFLICT: busy or changed/expired/consumed preview; see details.reason',
})
@ApiTooManyRequestsResponse({ description: 'RATE_LIMITED' })
@ApiServiceUnavailableResponse({
  description: 'SERVICE_UNAVAILABLE: Windows or tool unavailable',
})
@Controller('global-packages')
export class GlobalPackagesController implements IGlobalPackagesHttpController {
  constructor(
    @Inject(GlobalPackagesService)
    private readonly service: IGlobalPackagesService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read the retained global inventory without IO' })
  @ApiOkResponse({ schema: envelope(GlobalSnapshotEntity, 200, true) })
  getSnapshot(): IApiResponse<IGlobalSnapshot | null> {
    const snapshot = this.service.getSnapshot();
    return {
      statusCode: 200,
      message: 'Global inventory retrieved successfully',
      data:
        snapshot === null
          ? null
          : plainToInstance(GlobalSnapshotEntity, snapshot),
    };
  }

  @Post('inventory')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Explicitly refresh global package inventory' })
  @ApiAcceptedResponse({ schema: envelope(GlobalJobStartEntity, 202) })
  async inventory(
    @Body() input: GlobalActivityDto,
  ): Promise<IApiResponse<IGlobalJobStart>> {
    return {
      statusCode: 202,
      message: 'Global inventory refresh accepted',
      data: plainToInstance(
        GlobalJobStartEntity,
        await this.service.inventory(input),
      ),
    };
  }

  @Post('versions')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Explicitly load public registry version options' })
  @ApiAcceptedResponse({ schema: envelope(GlobalJobStartEntity, 202) })
  async versions(
    @Body() input: GlobalVersionsDto,
  ): Promise<IApiResponse<IGlobalJobStart>> {
    return {
      statusCode: 202,
      message: 'Global version lookup accepted',
      data: plainToInstance(
        GlobalJobStartEntity,
        await this.service.versions(input),
      ),
    };
  }

  @Post('preview')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Prepare one global package change for confirmation',
  })
  @ApiAcceptedResponse({ schema: envelope(GlobalJobStartEntity, 202) })
  async preview(
    @Body() input: GlobalPreviewDto,
  ): Promise<IApiResponse<IGlobalJobStart>> {
    return {
      statusCode: 202,
      message: 'Global package preview accepted',
      data: plainToInstance(
        GlobalJobStartEntity,
        await this.service.preview(input),
      ),
    };
  }

  @Get('jobs/latest')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Poll the latest retained global activity' })
  @ApiOkResponse({ schema: envelope(GlobalJobEntity, 200, true) })
  getLatest(): IApiResponse<IGlobalJob | null> {
    const job = this.service.getLatest();
    return {
      statusCode: 200,
      message: 'Latest global activity retrieved successfully',
      data: job === null ? null : plainToInstance(GlobalJobEntity, job),
    };
  }

  @Get('jobs/:id')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Poll a global activity without logs or IO' })
  @ApiOkResponse({ schema: envelope(GlobalJobEntity, 200) })
  getJob(@Param() params: GlobalJobIdDto): IApiResponse<IGlobalJob> {
    return {
      statusCode: 200,
      message: 'Global activity retrieved successfully',
      data: plainToInstance(GlobalJobEntity, this.service.getJob(params.id)),
    };
  }

  @Get('jobs/:id/logs')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read a bounded global activity log page' })
  @ApiOkResponse({ schema: envelope(GlobalLogPageEntity, 200) })
  getLogs(
    @Param() params: GlobalJobIdDto,
    @Query() query: GlobalLogQueryDto,
  ): IApiResponse<IGlobalLogPage> {
    return {
      statusCode: 200,
      message: 'Global activity output retrieved successfully',
      data: plainToInstance(
        GlobalLogPageEntity,
        this.service.getLogs(params.id, query.cursor),
      ),
    };
  }

  @Post('execute')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @DangerousOperation()
  @ApiOperation({ summary: 'Execute one confirmed global package mutation' })
  @ApiAcceptedResponse({ schema: envelope(GlobalJobStartEntity, 202) })
  async execute(
    @Body() input: GlobalExecuteDto,
  ): Promise<IApiResponse<IGlobalJobStart>> {
    const accepted = await this.service.execute(input);
    await this.service.waitForPreflight?.(accepted.jobId);
    return {
      statusCode: 202,
      message: 'Global package mutation accepted',
      data: plainToInstance(GlobalJobStartEntity, accepted),
    };
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @DangerousOperation()
  @ApiOperation({
    summary: 'Cancel or retry cleanup without repeating a mutation',
  })
  @ApiOkResponse({ schema: envelope(GlobalJobEntity, 200) })
  async cancel(
    @Param() params: GlobalJobIdDto,
  ): Promise<IApiResponse<IGlobalJob>> {
    return {
      statusCode: 200,
      message: 'Global activity cancellation processed',
      data: plainToInstance(
        GlobalJobEntity,
        await this.service.cancel(params.id),
      ),
    };
  }
}
