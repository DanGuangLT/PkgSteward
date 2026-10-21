import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Type } from '@nestjs/common';
import { PollingEndpoint } from '@/common/decorators/throttle.decorator';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import { ScanIdParamDto } from '@/scanner/dto/scan-id-param.dto';
import {
  ScanJobEntity,
  ScanResultEntity,
  ScanStartEntity,
} from '@/scanner/entities/scan.entity';
import type { IScannerController } from '@/scanner/interfaces/scanner.controller.interface';
import { ScannerService } from '@/scanner/scanner.service';

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

@ApiTags('scans')
@ApiExtraModels(ScanStartEntity, ScanJobEntity, ScanResultEntity)
@Controller('scans')
export class ScannerController implements IScannerController {
  constructor(private readonly scanner: ScannerService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Start a scan or return the currently running job' })
  @ApiAcceptedResponse({ schema: envelope(ScanStartEntity, 202) })
  startScan(): IApiResponse<ScanStartEntity> {
    return {
      statusCode: 202,
      message: 'Scan started successfully',
      data: this.scanner.startScan(),
    };
  }

  @Get('latest')
  @ApiOperation({
    summary: 'Get the latest completed or timed out scan result',
  })
  @ApiOkResponse({ schema: envelope(ScanResultEntity, 200) })
  @ApiNotFoundResponse({
    description: 'No cached scan result',
    schema: errorEnvelope(404, 'NOT_FOUND'),
  })
  getLatest(): IApiResponse<ScanResultEntity> {
    return {
      statusCode: 200,
      message: 'Latest scan retrieved successfully',
      data: this.scanner.getLatest(),
    };
  }

  @Get(':scanId')
  @PollingEndpoint()
  @ApiOperation({ summary: 'Poll the current or most recent scan job' })
  @ApiOkResponse({ schema: envelope(ScanJobEntity, 200) })
  @ApiBadRequestResponse({
    description: 'Invalid scan UUID v4',
    schema: errorEnvelope(400, 'VALIDATION_ERROR'),
  })
  @ApiNotFoundResponse({
    description: 'Unknown scan job',
    schema: errorEnvelope(404, 'NOT_FOUND'),
  })
  getScan(@Param() params: ScanIdParamDto): IApiResponse<ScanJobEntity> {
    return {
      statusCode: 200,
      message: 'Scan retrieved successfully',
      data: this.scanner.getScan(params.scanId),
    };
  }

  @Post(':scanId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a scan; terminal jobs remain unchanged' })
  @ApiOkResponse({ schema: envelope(ScanJobEntity, 200) })
  @ApiBadRequestResponse({
    description: 'Invalid scan UUID v4',
    schema: errorEnvelope(400, 'VALIDATION_ERROR'),
  })
  @ApiNotFoundResponse({
    description: 'Unknown scan job',
    schema: errorEnvelope(404, 'NOT_FOUND'),
  })
  cancelScan(@Param() params: ScanIdParamDto): IApiResponse<ScanJobEntity> {
    return {
      statusCode: 200,
      message: 'Scan cancellation processed successfully',
      data: this.scanner.cancelScan(params.scanId),
    };
  }
}
