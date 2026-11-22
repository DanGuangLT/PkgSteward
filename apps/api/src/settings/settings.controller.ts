import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { DangerousOperation } from '@/common/decorators/metadata';
import { ValidationException } from '@/common/exceptions/app.exception';
import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import {
  ExecuteSettingsDto,
  ImportSettingsPreviewDto,
  PreviewPluginUninstallDto,
  PreviewSettingsDto,
  ResetSettingsPreviewDto,
  UpdatePreferencesDto,
} from '@/settings/dto/settings.dto';
import { RejectPrototypePollutionGuard } from '@/settings/guards/reject-prototype-pollution.guard';
import type { ISettingsController } from '@/settings/interfaces/settings.controller.interface';
import type {
  IPluginInstallPreviewResponse,
  IPluginSandboxDocumentResponse,
  IPluginUninstallPreviewResponse,
  ISettingsExportResponse,
  ISettingsPreviewResponse,
  ISettingsSnapshot,
} from '@/settings/interfaces/settings.types';
import { PLUGIN_ID_REGEX } from '@/settings/plugins/interfaces/plugin.types';
import type { IPluginsCatalog } from '@/settings/plugins/interfaces/plugin.types';
import { SettingsService } from '@/settings/settings.service';

const MAX_PLUGIN_BINARY_UPLOAD_BYTES = 25 * 1024 * 1024;
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodePluginUploadHeaderFileName = (req: Request): string => {
  const raw = req.header('x-plugin-filename');
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationException(
      'Missing x-plugin-filename header for binary upload',
    );
  }
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep trimmed header string if percent-encoding is partial
  }
  const clean = basename(decoded)
    .replace(/[\r\n\0]/g, '')
    .trim();
  if (!clean || clean.length > 255) {
    throw new ValidationException(
      'Invalid x-plugin-filename header for binary upload',
    );
  }
  return clean;
};

const decodeStrictBase64 = (raw: unknown, fieldName: string): Buffer => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationException(
      `${fieldName} must be a non-empty base64 string`,
    );
  }
  const normalized = raw.replace(/\s+/g, '');
  if (!BASE64_REGEX.test(normalized) || normalized.length % 4 !== 0) {
    throw new ValidationException(`${fieldName} is not valid base64`);
  }
  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length === 0) {
    throw new ValidationException(`${fieldName} decoded to an empty payload`);
  }
  if (buffer.length > MAX_PLUGIN_BINARY_UPLOAD_BYTES) {
    throw new ValidationException(
      `Decoded ${fieldName} exceeds ${MAX_PLUGIN_BINARY_UPLOAD_BYTES} bytes`,
    );
  }
  return buffer;
};

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
      'Discover and validate local plugin manifests (sandboxed-web mode)',
  })
  async getPlugins(): Promise<IApiResponse<IPluginsCatalog>> {
    return {
      statusCode: 200,
      message: 'Plugin catalog retrieved successfully',
      data: await this.settingsService.getPluginsCatalog(),
    };
  }

  @Post('plugins/install/preview')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Preview installing a plugin from an uploaded file (octet-stream or base64) or remote URL',
  })
  async previewPluginInstall(
    @Req() req: Request,
  ): Promise<IApiResponse<IPluginInstallPreviewResponse>> {
    let preview: IPluginInstallPreviewResponse;
    if (Buffer.isBuffer(req.body)) {
      const fileName = decodePluginUploadHeaderFileName(req);
      preview = await this.settingsService.previewPluginInstallFromFile(
        fileName,
        req.body,
      );
    } else if (isPlainRecord(req.body)) {
      const allowedKeys = new Set(['url', 'fileName', 'contentBase64']);
      for (const key of Object.getOwnPropertyNames(req.body)) {
        if (!allowedKeys.has(key)) {
          throw new ValidationException(
            `Unknown field "${key}" in plugin install preview request`,
          );
        }
      }
      const hasUrl = req.body.url !== undefined;
      const hasFile =
        req.body.fileName !== undefined || req.body.contentBase64 !== undefined;
      if (hasUrl && hasFile) {
        throw new ValidationException(
          'Provide either "url" or "fileName"+"contentBase64", not both',
        );
      }
      if (hasUrl) {
        if (typeof req.body.url !== 'string' || req.body.url.length > 2048) {
          throw new ValidationException(
            '"url" must be a string <= 2048 characters',
          );
        }
        preview = await this.settingsService.previewPluginInstallFromUrl(
          req.body.url,
        );
      } else if (hasFile) {
        if (
          typeof req.body.fileName !== 'string' ||
          !req.body.fileName.trim() ||
          req.body.fileName.length > 255
        ) {
          throw new ValidationException(
            '"fileName" must be a non-empty string <= 255 characters',
          );
        }
        const buffer = decodeStrictBase64(
          req.body.contentBase64,
          'contentBase64',
        );
        preview = await this.settingsService.previewPluginInstallFromFile(
          req.body.fileName,
          buffer,
        );
      } else {
        throw new ValidationException(
          'Plugin install preview requires a URL or uploaded plugin package',
        );
      }
    } else {
      throw new ValidationException(
        'Invalid plugin install preview request body',
      );
    }

    return {
      statusCode: 200,
      message: 'Plugin install preview generated successfully',
      data: preview,
    };
  }

  @Post('plugins/install')
  @HttpCode(200)
  @DangerousOperation(
    'Install plugin package with safe extraction, SSRF checks & audit log',
  )
  @ApiOperation({
    summary:
      'Execute a previewed plugin installation after explicit confirmation',
  })
  async executePluginInstall(
    @Body() dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Plugin installed successfully',
      data: await this.settingsService.executePluginInstall(dto),
    };
  }

  @Post('plugins/uninstall/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview uninstalling an installed or preinstalled plugin',
  })
  async previewPluginUninstall(
    @Body() dto: PreviewPluginUninstallDto,
  ): Promise<IApiResponse<IPluginUninstallPreviewResponse>> {
    if (
      typeof dto?.pluginId !== 'string' ||
      !PLUGIN_ID_REGEX.test(dto.pluginId)
    ) {
      throw new ValidationException('Invalid pluginId');
    }
    return {
      statusCode: 200,
      message: 'Plugin uninstall preview generated successfully',
      data: await this.settingsService.previewPluginUninstall(dto.pluginId),
    };
  }

  @Post('plugins/uninstall')
  @HttpCode(200)
  @DangerousOperation('Uninstall plugin package from disk with audit log')
  @ApiOperation({
    summary: 'Execute a previewed plugin uninstall after explicit confirmation',
  })
  async executePluginUninstall(
    @Body() dto: ExecuteSettingsDto,
  ): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Plugin uninstalled successfully',
      data: await this.settingsService.executePluginUninstall(dto),
    };
  }

  @Post('plugins/restore-defaults')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restore preinstalled default plugins (such as wallpaper-engine)',
  })
  async restoreDefaultPlugins(): Promise<IApiResponse<ISettingsSnapshot>> {
    return {
      statusCode: 200,
      message: 'Default plugins restored successfully',
      data: await this.settingsService.restoreDefaultPlugins(),
    };
  }

  @Post('plugins/wallpaper-media')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Upload custom image/video wallpaper asset directly to the wallpaper-engine plugin',
  })
  async uploadWallpaperMedia(
    @Req() req: Request,
  ): Promise<IApiResponse<ISettingsSnapshot>> {
    let fileName: string;
    let buffer: Buffer;
    if (Buffer.isBuffer(req.body)) {
      fileName = decodePluginUploadHeaderFileName(req);
      buffer = req.body;
    } else if (isPlainRecord(req.body)) {
      const allowedKeys = new Set(['fileName', 'contentBase64']);
      for (const key of Object.getOwnPropertyNames(req.body)) {
        if (!allowedKeys.has(key)) {
          throw new ValidationException(
            `Unknown field "${key}" in wallpaper media upload`,
          );
        }
      }
      if (
        typeof req.body.fileName !== 'string' ||
        !req.body.fileName.trim() ||
        req.body.fileName.length > 255
      ) {
        throw new ValidationException(
          '"fileName" must be a non-empty string <= 255 characters',
        );
      }
      fileName = req.body.fileName;
      buffer = decodeStrictBase64(req.body.contentBase64, 'contentBase64');
    } else {
      throw new ValidationException('Invalid wallpaper media upload payload');
    }

    return {
      statusCode: 200,
      message: 'Wallpaper media uploaded successfully',
      data: await this.settingsService.uploadWallpaperMedia(fileName, buffer),
    };
  }

  @Get('plugins/:pluginId/sandbox-document')
  @ApiOperation({
    summary:
      'Build self-contained HTML document with CSP for sandboxed web-wallpaper iframe',
  })
  async getPluginSandboxDocument(
    @Param('pluginId') pluginId: string,
  ): Promise<IApiResponse<IPluginSandboxDocumentResponse>> {
    if (!PLUGIN_ID_REGEX.test(pluginId)) {
      throw new ValidationException('Invalid plugin id');
    }
    return {
      statusCode: 200,
      message: 'Plugin sandbox document retrieved successfully',
      data: await this.settingsService.getPluginSandboxDocument(pluginId),
    };
  }

  @Get('plugins/:pluginId/assets/{*assetPath}')
  @ApiOperation({
    summary: 'Stream a validated non-HTML asset owned by an installed plugin',
  })
  async getPluginAsset(
    @Param('pluginId') pluginId: string,
    @Param('assetPath') assetPathParam: string | string[],
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const relativePath = Array.isArray(assetPathParam)
      ? assetPathParam.join('/')
      : (assetPathParam ?? '');
    const asset = await this.settingsService.getPluginAsset(
      pluginId,
      relativePath,
    );
    response.setHeader('Content-Type', asset.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (
      asset.contentType.includes('svg') ||
      asset.contentType.startsWith('text/')
    ) {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; sandbox",
      );
    }
    return new StreamableFile(createReadStream(asset.absolutePath));
  }
}
