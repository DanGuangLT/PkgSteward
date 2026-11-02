import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
import { PollingEndpoint } from '@/common/decorators/throttle.decorator';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { ProjectAnalysisIdParamDto } from '@/projects/dto/project-analysis-id-param.dto';
import { ProjectPathQueryDto } from '@/projects/dto/project-path-query.dto';
import { StartProjectAnalysisDto } from '@/projects/dto/start-project-analysis.dto';
import {
  ProjectAnalysisJobEntity,
  ProjectAnalysisStartEntity,
  ProjectDetailEntity,
} from '@/projects/entities/project.entity';
import type { IProjectsController } from '@/projects/interfaces/projects.controller.interface';
import { ProjectsService } from '@/projects/projects.service';

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

const requestErrors = () =>
  applyDecorators(
    ApiBadRequestResponse({ schema: errorEnvelope(400, 'VALIDATION_ERROR') }),
    ApiNotFoundResponse({ schema: errorEnvelope(404, 'NOT_FOUND') }),
    ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') }),
  );

const inputErrors = () =>
  applyDecorators(
    requestErrors(),
    ApiForbiddenResponse({ schema: errorEnvelope(403, 'FORBIDDEN') }),
    ApiConflictResponse({
      description:
        'Unscanned or changed inputs, a busy mutation gate, or another running analysis. Only ANALYSIS_RUNNING has a followable job.',
      schema: {
        ...errorEnvelope(409, 'CONFLICT'),
        properties: {
          ...errorEnvelope(409, 'CONFLICT').properties,
          details: {
            anyOf: [
              {
                type: 'object',
                required: ['reason', 'jobId', 'path'],
                properties: {
                  reason: { type: 'string', enum: ['ANALYSIS_RUNNING'] },
                  jobId: { type: 'string', format: 'uuid' },
                  path: {
                    type: 'string',
                    description: 'Lexical running request path',
                  },
                },
              },
              {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: {
                    type: 'string',
                    enum: ['PROJECT_NOT_SCANNED', 'INPUT_CHANGED'],
                  },
                },
              },
              {
                type: 'object',
                description:
                  'Existing mutation-gate details; no followable analysis job',
              },
            ],
          },
        },
      },
    }),
  );

@ApiTags('projects')
@ApiExtraModels(
  ProjectDetailEntity,
  ProjectAnalysisStartEntity,
  ProjectAnalysisJobEntity,
)
@Controller('projects')
export class ProjectsController implements IProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read local inputs for a project in the latest scan',
  })
  @ApiOkResponse({ schema: envelope(ProjectDetailEntity, 200) })
  @inputErrors()
  async detail(
    @Query() query: ProjectPathQueryDto,
  ): Promise<IApiResponse<ProjectDetailEntity>> {
    return {
      statusCode: 200,
      message: 'Project detail retrieved successfully',
      data: plainToInstance(
        ProjectDetailEntity,
        await this.projects.detail(query.path),
      ),
    };
  }

  @Post('analyses')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start or coalesce an explicit public-registry project analysis',
  })
  @ApiAcceptedResponse({ schema: envelope(ProjectAnalysisStartEntity, 202) })
  @inputErrors()
  @ApiServiceUnavailableResponse({
    schema: errorEnvelope(503, 'SERVICE_UNAVAILABLE'),
  })
  async start(
    @Body() input: StartProjectAnalysisDto,
  ): Promise<IApiResponse<ProjectAnalysisStartEntity>> {
    return {
      statusCode: 202,
      message: 'Project analysis started successfully',
      data: plainToInstance(
        ProjectAnalysisStartEntity,
        await this.projects.start(input),
      ),
    };
  }

  @Get('analyses/:jobId')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Poll a defensive analysis snapshot without revalidating inputs',
  })
  @ApiOkResponse({ schema: envelope(ProjectAnalysisJobEntity, 200) })
  @requestErrors()
  get(
    @Param() params: ProjectAnalysisIdParamDto,
  ): IApiResponse<ProjectAnalysisJobEntity> {
    return {
      statusCode: 200,
      message: 'Project analysis retrieved successfully',
      data: plainToInstance(
        ProjectAnalysisJobEntity,
        this.projects.get(params.jobId),
      ),
    };
  }

  @Post('analyses/:jobId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel an analysis; terminal jobs remain unchanged',
  })
  @ApiOkResponse({ schema: envelope(ProjectAnalysisJobEntity, 200) })
  @requestErrors()
  cancel(
    @Param() params: ProjectAnalysisIdParamDto,
  ): IApiResponse<ProjectAnalysisJobEntity> {
    return {
      statusCode: 200,
      message: 'Project analysis cancellation processed successfully',
      data: plainToInstance(
        ProjectAnalysisJobEntity,
        this.projects.cancel(params.jobId),
      ),
    };
  }
}
