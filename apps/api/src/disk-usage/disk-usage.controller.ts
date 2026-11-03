import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
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
import { PollingEndpoint } from '@/common/decorators/throttle.decorator';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { StartDiskUsageDto } from '@/disk-usage/dto/start-disk-usage.dto';
import { DiskUsageIdParamDto } from '@/disk-usage/dto/disk-usage-id-param.dto';
import {
  DiskUsageJobEntity,
  DiskUsageStartEntity,
} from '@/disk-usage/entities/disk-usage.entity';
import type { IDiskUsageController } from '@/disk-usage/interfaces/disk-usage.controller.interface';
import { DiskUsageService } from '@/disk-usage/disk-usage.service';

const envelope = (entity: Type, statusCode: number) => ({
  type: 'object' as const,
  required: ['statusCode', 'message', 'code', 'data', 'timestamp', 'path'],
  properties: {
    statusCode: { type: 'integer' as const, example: statusCode },
    message: { type: 'string' as const },
    code: { type: 'string' as const, example: 'SUCCESS' },
    data: { $ref: getSchemaPath(entity) },
    timestamp: { type: 'string' as const, format: 'date-time' },
    path: { type: 'string' as const },
  },
});

const errorEnvelope = (statusCode: number, code: string) => ({
  type: 'object' as const,
  required: ['statusCode', 'message', 'code', 'timestamp', 'path'],
  properties: {
    statusCode: { type: 'integer' as const, example: statusCode },
    message: { type: 'string' as const },
    code: { type: 'string' as const, example: code },
    timestamp: { type: 'string' as const, format: 'date-time' },
    path: { type: 'string' as const },
  },
});

@ApiTags('disk-usage')
@ApiExtraModels(DiskUsageStartEntity, DiskUsageJobEntity)
@Controller('disk-usage')
export class DiskUsageController implements IDiskUsageController {
  constructor(private readonly diskUsage: DiskUsageService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Start a directory or package measurement' })
  @ApiAcceptedResponse({ schema: envelope(DiskUsageStartEntity, 202) })
  @ApiBadRequestResponse({
    description: 'Invalid body, path or package view',
    schema: errorEnvelope(400, 'VALIDATION_ERROR'),
  })
  @ApiForbiddenResponse({
    description: 'Path outside the allowlist or protected',
    schema: errorEnvelope(403, 'FORBIDDEN'),
  })
  @ApiNotFoundResponse({
    description: 'Measurement path not found',
    schema: errorEnvelope(404, 'NOT_FOUND'),
  })
  @ApiConflictResponse({
    description: 'Another path or view is running',
    schema: {
      ...errorEnvelope(409, 'CONFLICT'),
      required: [...errorEnvelope(409, 'CONFLICT').required, 'details'],
      properties: {
        ...errorEnvelope(409, 'CONFLICT').properties,
        details: {
          type: 'object',
          required: ['jobId', 'path'],
          properties: {
            jobId: { type: 'string', format: 'uuid' },
            path: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') })
  @ApiServiceUnavailableResponse({
    description: 'Service is shutting down',
    schema: errorEnvelope(503, 'SERVICE_UNAVAILABLE'),
  })
  async start(
    @Body() input: StartDiskUsageDto,
  ): Promise<IApiResponse<DiskUsageStartEntity>> {
    const started = await this.diskUsage.start(input);
    return {
      statusCode: 202,
      message: 'Disk usage measurement started successfully',
      data: plainToInstance(DiskUsageStartEntity, started),
    };
  }

  @Get(':jobId')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Poll the current or most recent measurement' })
  @ApiOkResponse({ schema: envelope(DiskUsageJobEntity, 200) })
  @ApiBadRequestResponse({
    description: 'Invalid job UUID v4',
    schema: errorEnvelope(400, 'VALIDATION_ERROR'),
  })
  @ApiNotFoundResponse({
    description: 'Unknown measurement job',
    schema: errorEnvelope(404, 'NOT_FOUND'),
  })
  @ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') })
  get(@Param() params: DiskUsageIdParamDto): IApiResponse<DiskUsageJobEntity> {
    return {
      statusCode: 200,
      message: 'Disk usage measurement retrieved successfully',
      data: plainToInstance(
        DiskUsageJobEntity,
        this.diskUsage.get(params.jobId),
      ),
    };
  }

  @Post(':jobId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel a measurement; terminal jobs remain unchanged',
  })
  @ApiOkResponse({ schema: envelope(DiskUsageJobEntity, 200) })
  @ApiBadRequestResponse({
    description: 'Invalid job UUID v4',
    schema: errorEnvelope(400, 'VALIDATION_ERROR'),
  })
  @ApiNotFoundResponse({
    description: 'Unknown measurement job',
    schema: errorEnvelope(404, 'NOT_FOUND'),
  })
  @ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') })
  cancel(
    @Param() params: DiskUsageIdParamDto,
  ): IApiResponse<DiskUsageJobEntity> {
    return {
      statusCode: 200,
      message: 'Disk usage cancellation processed successfully',
      data: plainToInstance(
        DiskUsageJobEntity,
        this.diskUsage.cancel(params.jobId),
      ),
    };
  }
}
