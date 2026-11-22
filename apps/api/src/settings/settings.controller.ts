import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DangerousOperation } from '@/common/decorators/metadata';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import {
  ExecuteSettingsDto,
  ImportSettingsPreviewDto,
  PreviewSettingsDto,
  ResetSettingsPreviewDto,
  UpdatePreferencesDto,
} from '@/settings/dto/settings.dto';
import { RejectPrototypePollutionGuard } from '@/settings/guards/reject-prototype-pollution.guard';
import type { ISettingsController } from '@/settings/interfaces/settings.controller.interface';
import type {
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
} from '@/settings/interfaces/settings.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';
import { SettingsService } from '@/settings/settings.service';

@ApiTags('settings')
@UseGuards(RejectPrototypePollutionGuard)
@Controller('settings')
export class SettingsController implements ISettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Get effective settings, value sources, restart flags, and plugin catalog',
  })
  async getSettings(): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Settings retrieved successfully',
      data: await this.settingsService.getSnapshot(),
    };
  }

  @Patch('preferences')
  @ApiOperation({
    summary:
      'Update non-privileged appearance, behavior, desktop, or plugin entry preferences',
  })
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
  ): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Preferences updated successfully',
      data: await this.settingsService.updatePreferences(
        dto as unknown as Record<string, unknown>,
      ),
    };
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Preview runtime, server, or privileged plugin configuration changes',
  })
  async previewUpdate(
    @Body() dto: PreviewSettingsDto,
  ): Promise<IApiResponse<ISettingsPreviewResponse>> {
    return {
      statusCode: 200,
      message: 'Settings preview generated successfully',
      data: await this.settingsService.previewUpdate(
        dto as unknown as Record<string, unknown>,
      ),
    };
  }

  @Patch()
  @DangerousOperation(
    'Apply confirmed settings changes with hot-reload & audit log',
  )
  @ApiOperation({
    summary: 'Apply previewed settings changes after explicit confirmation',
  })
  async executeUpdate(
    @Body() dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Settings updated successfully',
      data: await this.settingsService.executePreviewedAction('update', dto),
    };
  }

  @Get('export')
  @ApiOperation({
    summary: 'Export complete effective settings document (schemaVersion 1)',
  })
  async exportSettings(): Promise<IApiResponse<ISettingsExportResponse>> {
    return {
      statusCode: 200,
      message: 'Settings exported successfully',
      data: await this.settingsService.exportSettings(),
    };
  }

  @Post('import/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Validate and preview imported settings.json document',
  })
  async previewImport(
    @Body() dto: ImportSettingsPreviewDto,
  ): Promise<IApiResponse<ISettingsPreviewResponse>> {
    return {
      statusCode: 200,
      message: 'Settings import preview generated successfully',
      data: await this.settingsService.previewImport(dto.document),
    };
  }

  @Post('import')
  @HttpCode(200)
  @DangerousOperation('Import settings document with hot-reload & audit log')
  @ApiOperation({
    summary: 'Apply previewed settings import after explicit confirmation',
  })
  async executeImport(
    @Body() dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Settings imported successfully',
      data: await this.settingsService.executePreviewedAction('import', dto),
    };
  }

  @Post('reset/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview resetting one settings section or all settings',
  })
  async previewReset(
    @Body() dto: ResetSettingsPreviewDto,
  ): Promise<IApiResponse<ISettingsPreviewResponse>> {
    return {
      statusCode: 200,
      message: 'Settings reset preview generated successfully',
      data: await this.settingsService.previewReset(dto.scope),
    };
  }

  @Post('reset')
  @HttpCode(200)
  @DangerousOperation('Reset settings section(s) with hot-reload & audit log')
  @ApiOperation({
    summary: 'Apply previewed settings reset after explicit confirmation',
  })
  async executeReset(
    @Body() dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Settings reset successfully',
      data: await this.settingsService.executePreviewedAction('reset', dto),
    };
  }

  @Get('plugins')
  @ApiOperation({
    summary:
      'Discover and validate local plugin manifests (read-only manifest-only mode)',
  })
  async getPlugins(): Promise<IApiResponse<IPluginsCatalog>> {
    return {
      statusCode: 200,
      message: 'Plugin catalog retrieved successfully',
      data: await this.settingsService.getPluginsCatalog(),
    };
  }
}
