import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
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
import type { Response } from 'express';
import { plainToInstance } from 'class-transformer';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { DangerousOperation } from '@/common/decorators/metadata';
import { PollingEndpoint } from '@/common/decorators/throttle.decorator';
import { RunnerPathQueryDto } from '@/npm-runner/dto/runner-path-query.dto';
import { StartNpmRunDto } from '@/npm-runner/dto/start-npm-run.dto';
import { RunIdParamDto } from '@/npm-runner/dto/run-id-param.dto';
import { RunLogQueryDto } from '@/npm-runner/dto/run-log-query.dto';
import {
  RunnerContextEntity,
  RunStartEntity,
  RunJobEntity,
  RunLogPageEntity,
} from '@/npm-runner/entities/npm-runner.entity';
import type { INpmRunnerController } from '@/npm-runner/interfaces/npm-runner.controller.interface';
import { NpmRunnerService } from '@/npm-runner/npm-runner.service';

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

@ApiTags('npm-runs')
@ApiExtraModels(
  RunnerContextEntity,
  RunStartEntity,
  RunJobEntity,
  RunLogPageEntity,
)
@ApiBadRequestResponse({ schema: errorEnvelope(400, 'VALIDATION_ERROR') })
@ApiForbiddenResponse({ schema: errorEnvelope(403, 'FORBIDDEN') })
@ApiNotFoundResponse({ schema: errorEnvelope(404, 'NOT_FOUND') })
@ApiConflictResponse({
  schema: {
    ...errorEnvelope(409, 'CONFLICT'),
    properties: {
      ...errorEnvelope(409, 'CONFLICT').properties,
      details: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['RUNNING', 'READERS_RUNNING'] },
          jobId: { type: 'string', format: 'uuid' },
          requestPath: { type: 'string' },
        },
      },
    },
  },
})
@ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') })
@ApiServiceUnavailableResponse({
  schema: errorEnvelope(503, 'SERVICE_UNAVAILABLE'),
})
@Controller('npm-runs')
export class NpmRunnerController implements INpmRunnerController {
  constructor(private readonly service: NpmRunnerService) {}

  @Get('context')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read local runner context without executing a tool',
  })
  @ApiOkResponse({ schema: envelope(RunnerContextEntity, 200) })
  async context(
    @Query() query: RunnerPathQueryDto,
  ): Promise<IApiResponse<RunnerContextEntity>> {
    return {
      statusCode: 200,
      message: 'Runner context retrieved successfully',
      data: plainToInstance(
        RunnerContextEntity,
        await this.service.context(query.path),
      ),
    };
  }

  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @DangerousOperation()
  @ApiOperation({
    summary:
      'Start one explicit project command or replay the retained request',
  })
  @ApiAcceptedResponse({ schema: envelope(RunStartEntity, 202) })
  async start(
    @Body() body: StartNpmRunDto,
  ): Promise<IApiResponse<RunStartEntity>> {
    return {
      statusCode: 202,
      message: 'Command run accepted successfully',
      data: plainToInstance(RunStartEntity, await this.service.start(body)),
    };
  }

  @Get('latest')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read the latest retained run' })
  @ApiOkResponse({ schema: envelope(RunJobEntity, 200) })
  latest(): IApiResponse<RunJobEntity> {
    return {
      statusCode: 200,
      message: 'Latest command run retrieved successfully',
      data: plainToInstance(RunJobEntity, this.service.latest()),
    };
  }

  @Get(':id')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Poll a defensive run snapshot without IO' })
  @ApiOkResponse({ schema: envelope(RunJobEntity, 200) })
  get(@Param() params: RunIdParamDto): IApiResponse<RunJobEntity> {
    return {
      statusCode: 200,
      message: 'Command run retrieved successfully',
      data: plainToInstance(RunJobEntity, this.service.get(params.id)),
    };
  }

  @Get(':id/logs')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read a bounded sanitized log page by cursor' })
  @ApiOkResponse({ schema: envelope(RunLogPageEntity, 200) })
  logs(
    @Param() params: RunIdParamDto,
    @Query() query: RunLogQueryDto,
  ): IApiResponse<RunLogPageEntity> {
    return {
      statusCode: 200,
      message: 'Command output retrieved successfully',
      data: plainToInstance(
        RunLogPageEntity,
        this.service.logs(params.id, query.cursor),
      ),
    };
  }

  @Post(':id/cancel')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @DangerousOperation()
  @ApiOperation({
    summary:
      'Stop a run or explicitly retry pending cleanup without respawning',
  })
  @ApiOkResponse({ schema: envelope(RunJobEntity, 200) })
  @ApiAcceptedResponse({ schema: envelope(RunJobEntity, 202) })
  async cancel(
    @Param() params: RunIdParamDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<IApiResponse<RunJobEntity>> {
    const job = await this.service.cancel(params.id);
    const statusCode = job.status === 'stopping' || job.gateHeld ? 202 : 200;
    response.status(statusCode);
    return {
      statusCode,
      message: 'Command cancellation processed successfully',
      data: plainToInstance(RunJobEntity, job),
    };
  }
}
