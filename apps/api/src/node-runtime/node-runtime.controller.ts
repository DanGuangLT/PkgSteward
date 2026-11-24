import { Controller, Get, Header, Query } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import {
  GetNodeRuntimeOverviewQueryDto,
  GetProjectNodeRuntimeQueryDto,
} from '@/node-runtime/dto/node-runtime-query.dto';
import {
  ManagerCommandSuggestionEntity,
  NodeManagerInfoEntity,
  NodeRuntimeOverviewEntity,
  NodeRuntimeSummaryCountsEntity,
  ProjectNodeCompatibilityEntity,
  ProjectNodeRequirementEntity,
  ProjectNodeRuntimeDetailEntity,
} from '@/node-runtime/entities/node-runtime.entity';
import type { INodeRuntimeController } from '@/node-runtime/interfaces/node-runtime.controller.interface';
import type {
  INodeRuntimeOverview,
  IProjectNodeRuntimeDetail,
} from '@/node-runtime/interfaces/node-runtime.types';
import { NodeRuntimeService } from '@/node-runtime/node-runtime.service';

const envelope = (entity: Type) => ({
  type: 'object' as const,
  required: ['statusCode', 'message', 'code', 'data', 'timestamp', 'path'],
  properties: {
    statusCode: { type: 'integer' as const, example: 200 },
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

@ApiTags('Node Runtime')
@ApiExtraModels(
  NodeManagerInfoEntity,
  ProjectNodeRequirementEntity,
  ManagerCommandSuggestionEntity,
  ProjectNodeCompatibilityEntity,
  NodeRuntimeSummaryCountsEntity,
  NodeRuntimeOverviewEntity,
  ProjectNodeRuntimeDetailEntity,
)
@Controller('node-runtime')
export class NodeRuntimeController implements INodeRuntimeController {
  constructor(private readonly nodeRuntimeService: NodeRuntimeService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Inspect active Node.js runtime, installed version managers, and project compatibility across the latest scan (read-only)',
  })
  @ApiOkResponse({ schema: envelope(NodeRuntimeOverviewEntity) })
  @ApiBadRequestResponse({ schema: errorEnvelope(400, 'VALIDATION_ERROR') })
  @ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') })
  async getOverview(
    @Query() query: GetNodeRuntimeOverviewQueryDto,
  ): Promise<IApiResponse<INodeRuntimeOverview>> {
    const data = await this.nodeRuntimeService.getOverview(
      query.refresh === true,
    );
    return {
      statusCode: 200,
      message: 'Node runtime overview retrieved successfully',
      data,
    };
  }

  @Get('project')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Inspect declared Node.js runtime requirements and compatibility for a single project path (read-only)',
  })
  @ApiOkResponse({ schema: envelope(ProjectNodeRuntimeDetailEntity) })
  @ApiBadRequestResponse({ schema: errorEnvelope(400, 'VALIDATION_ERROR') })
  @ApiForbiddenResponse({ schema: errorEnvelope(403, 'FORBIDDEN') })
  @ApiNotFoundResponse({ schema: errorEnvelope(404, 'NOT_FOUND') })
  @ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') })
  async getProjectDetail(
    @Query() query: GetProjectNodeRuntimeQueryDto,
  ): Promise<IApiResponse<IProjectNodeRuntimeDetail>> {
    const data = await this.nodeRuntimeService.getProjectDetail(query.path);
    return {
      statusCode: 200,
      message: 'Project Node runtime compatibility retrieved successfully',
      data,
    };
  }
}
