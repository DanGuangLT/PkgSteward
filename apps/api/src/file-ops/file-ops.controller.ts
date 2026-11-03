import {
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
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { DangerousOperation } from '@/common/decorators/metadata';
import { PollingEndpoint } from '@/common/decorators/throttle.decorator';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { CleanupPreviewDto } from '@/file-ops/dto/cleanup-preview.dto';
import { DeleteExecuteDto } from '@/file-ops/dto/delete-execute.dto';
import { DeletePreviewDto } from '@/file-ops/dto/delete-preview.dto';
import {
  OperationIdParamDto,
  PreviewIdParamDto,
} from '@/file-ops/dto/file-ops-id-param.dto';
import { PreviewSummaryDto } from '@/file-ops/dto/preview-summary.dto';
import { TreeQueryDto } from '@/file-ops/dto/tree-query.dto';
import {
  FileOpsOperationEntity,
  FileOpsPreviewEntity,
  FileTreeLevelEntity,
  OperationStartEntity,
  PreviewStartEntity,
  PreviewSummaryEntity,
} from '@/file-ops/entities/file-ops.entity';
import { FileOpsService } from '@/file-ops/file-ops.service';
import type { IFileOpsController } from '@/file-ops/interfaces/file-ops.controller.interface';

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

const BadRequest = (description: string) =>
  ApiBadRequestResponse({
    description,
    schema: errorEnvelope(400, 'VALIDATION_ERROR'),
  });
const NotFound = (description: string) =>
  ApiNotFoundResponse({
    description,
    schema: errorEnvelope(404, 'NOT_FOUND'),
  });
const Conflict = (description: string) =>
  ApiConflictResponse({
    description,
    schema: errorEnvelope(409, 'CONFLICT'),
  });
const RateLimited = () =>
  ApiTooManyRequestsResponse({ schema: errorEnvelope(429, 'RATE_LIMITED') });

@ApiTags('file-ops')
@ApiExtraModels(
  FileTreeLevelEntity,
  PreviewStartEntity,
  FileOpsPreviewEntity,
  PreviewSummaryEntity,
  OperationStartEntity,
  FileOpsOperationEntity,
)
@Controller('file-ops')
export class FileOpsController implements IFileOpsController {
  constructor(private readonly fileOps: FileOpsService) {}

  @Get('tree')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List one directory level of a scanned project' })
  @ApiOkResponse({ schema: envelope(FileTreeLevelEntity, 200) })
  @BadRequest('Invalid path or a path outside scanned projects')
  @ApiForbiddenResponse({
    description: 'Path outside the allowlist or protected',
    schema: errorEnvelope(403, 'FORBIDDEN'),
  })
  @NotFound('No scan result or the path does not exist')
  @RateLimited()
  async getTree(
    @Query() query: TreeQueryDto,
  ): Promise<IApiResponse<FileTreeLevelEntity>> {
    return {
      statusCode: 200,
      message: 'File tree retrieved successfully',
      data: plainToInstance(
        FileTreeLevelEntity,
        await this.fileOps.getTree(query.path),
      ),
    };
  }

  @Post('cleanup/preview')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Find and measure cleanup targets; deletes nothing',
  })
  @ApiAcceptedResponse({ schema: envelope(PreviewStartEntity, 202) })
  @BadRequest('Invalid filters')
  @NotFound('No scan result')
  @Conflict('A preview or file operation is running')
  @RateLimited()
  startCleanupPreview(
    @Body() input: CleanupPreviewDto,
  ): IApiResponse<PreviewStartEntity> {
    return {
      statusCode: 202,
      message: 'Cleanup preview started successfully',
      data: plainToInstance(
        PreviewStartEntity,
        this.fileOps.startCleanupPreview(input),
      ),
    };
  }

  @Post('delete/preview')
  @HttpCode(202)
  @ApiOperation({ summary: 'Assess and measure paths; deletes nothing' })
  @ApiAcceptedResponse({ schema: envelope(PreviewStartEntity, 202) })
  @BadRequest('Invalid path list')
  @NotFound('No scan result')
  @Conflict('A preview or file operation is running')
  @RateLimited()
  startDeletePreview(
    @Body() input: DeletePreviewDto,
  ): IApiResponse<PreviewStartEntity> {
    return {
      statusCode: 202,
      message: 'Delete preview started successfully',
      data: plainToInstance(
        PreviewStartEntity,
        this.fileOps.startDeletePreview(input),
      ),
    };
  }

  @Get('previews/:previewId')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Poll a preview' })
  @ApiOkResponse({ schema: envelope(FileOpsPreviewEntity, 200) })
  @BadRequest('Invalid preview UUID v4')
  @NotFound('Unknown preview')
  @RateLimited()
  getPreview(
    @Param() params: PreviewIdParamDto,
  ): IApiResponse<FileOpsPreviewEntity> {
    return {
      statusCode: 200,
      message: 'Preview retrieved successfully',
      data: plainToInstance(
        FileOpsPreviewEntity,
        this.fileOps.getPreview(params.previewId),
      ),
    };
  }

  @Post('previews/:previewId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stop measuring; targets already measured stay selectable',
  })
  @ApiOkResponse({ schema: envelope(FileOpsPreviewEntity, 200) })
  @BadRequest('Invalid preview UUID v4')
  @NotFound('Unknown preview')
  @RateLimited()
  cancelPreview(
    @Param() params: PreviewIdParamDto,
  ): IApiResponse<FileOpsPreviewEntity> {
    return {
      statusCode: 200,
      message: 'Preview cancellation processed successfully',
      data: plainToInstance(
        FileOpsPreviewEntity,
        this.fileOps.cancelPreview(params.previewId),
      ),
    };
  }

  @Post('previews/:previewId/summary')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Compute risk, confirmation text and totals for a selection',
  })
  @ApiOkResponse({ schema: envelope(PreviewSummaryEntity, 200) })
  @BadRequest('Invalid preview UUID v4 or selection')
  @NotFound('Unknown preview')
  @Conflict('Preview is still running')
  @RateLimited()
  summarizePreview(
    @Param() params: PreviewIdParamDto,
    @Body() input: PreviewSummaryDto,
  ): IApiResponse<PreviewSummaryEntity> {
    return {
      statusCode: 200,
      message: 'Preview summary computed successfully',
      data: plainToInstance(
        PreviewSummaryEntity,
        this.fileOps.summarizePreview(params.previewId, input.paths),
      ),
    };
  }

  @Post('delete/execute')
  @HttpCode(202)
  @DangerousOperation('Delete selected files, folders or projects')
  @ApiOperation({
    summary: 'Delete previewed targets; repeating a call replays the operation',
  })
  @ApiAcceptedResponse({ schema: envelope(OperationStartEntity, 202) })
  @BadRequest('Invalid body, selection or confirmation')
  @NotFound('Unknown preview')
  @Conflict(
    'CONFLICT, SCAN_CHANGED, RISK_CHANGED or TARGET_CHANGED; details.paths lists the affected targets',
  )
  @ApiInternalServerErrorResponse({
    description: 'The audit log is unavailable; nothing was deleted',
    schema: errorEnvelope(500, 'INTERNAL_SERVER_ERROR'),
  })
  @RateLimited()
  async startExecute(
    @Body() input: DeleteExecuteDto,
  ): Promise<IApiResponse<OperationStartEntity>> {
    return {
      statusCode: 202,
      message: 'File operation started successfully',
      data: plainToInstance(
        OperationStartEntity,
        await this.fileOps.startExecute(input),
      ),
    };
  }

  // Before `operations/:operationId`, or "active" fails its UUID validation.
  @Get('operations/active')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get the running file operation; data is null when idle',
  })
  @ApiOkResponse({ schema: envelope(FileOpsOperationEntity, 200) })
  @RateLimited()
  getActiveOperation(): IApiResponse<FileOpsOperationEntity | null> {
    const operation = this.fileOps.getActiveOperation();
    return {
      statusCode: 200,
      message: 'Active file operation retrieved successfully',
      data: operation && plainToInstance(FileOpsOperationEntity, operation),
    };
  }

  @Get('operations/:operationId')
  @PollingEndpoint()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Poll a file operation' })
  @ApiOkResponse({ schema: envelope(FileOpsOperationEntity, 200) })
  @BadRequest('Invalid operation UUID v4')
  @NotFound('Unknown operation')
  @RateLimited()
  getOperation(
    @Param() params: OperationIdParamDto,
  ): IApiResponse<FileOpsOperationEntity> {
    return {
      statusCode: 200,
      message: 'File operation retrieved successfully',
      data: plainToInstance(
        FileOpsOperationEntity,
        this.fileOps.getOperation(params.operationId),
      ),
    };
  }

  @Post('operations/:operationId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stop after the current target; finished work stays deleted',
  })
  @ApiOkResponse({ schema: envelope(FileOpsOperationEntity, 200) })
  @BadRequest('Invalid operation UUID v4')
  @NotFound('Unknown operation')
  @RateLimited()
  cancelOperation(
    @Param() params: OperationIdParamDto,
  ): IApiResponse<FileOpsOperationEntity> {
    return {
      statusCode: 200,
      message: 'File operation cancellation processed successfully',
      data: plainToInstance(
        FileOpsOperationEntity,
        this.fileOps.cancelOperation(params.operationId),
      ),
    };
  }
}
