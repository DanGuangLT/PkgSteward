import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PathPlatform } from '@/common/utils/path.util';
import { toPathPlatform } from '@/common/utils/path.util';
import { STARTUP_ENV_ONLY_KEY } from '@/config/config-loader';
import { parseScanRootPaths } from '@/config/environment/scan-roots';
import type { ScanRoots } from '@/config/environment/scan-roots';
import type {
  IRuntimeSettings,
  IServerSettings,
} from '@/settings/schema/settings.schema';

const normalizeScanRootPaths = (raw: string | undefined): string => {
  if (typeof raw !== 'string') return '*';
  const trimmed = raw.trim();
  if (trimmed === '') return '*';
  try {
    const parsed = parseScanRootPaths(trimmed, toPathPlatform());
    return parsed.kind === 'all-fixed-drives' ? '*' : trimmed;
  } catch {
    return trimmed;
  }
};

@Injectable()
export class RuntimeConfigService {
  private runtime: IRuntimeSettings;
  private readonly startupServer: Readonly<IServerSettings>;
  private readonly startupEnvOnly:
    Readonly<Record<string, string | undefined>> | undefined;

  constructor(configService: ConfigService) {
    const rawStartupEnv = configService.get<unknown>(STARTUP_ENV_ONLY_KEY);
    this.startupEnvOnly =
      rawStartupEnv &&
      typeof rawStartupEnv === 'object' &&
      !Array.isArray(rawStartupEnv)
        ? (rawStartupEnv as Readonly<Record<string, string | undefined>>)
        : undefined;
    const rawScanRoots = configService.get<string>('SCAN_ROOT_PATHS');
    const scanTimeout = configService.get<unknown>('SCAN_TIMEOUT_MS');
    const npmTimeout = configService.get<unknown>('NPM_COMMAND_TIMEOUT_MS');
    const depth = Number(configService.get<number>('MAX_SCAN_DEPTH') ?? 0);

    this.runtime = {
      scanRootPaths: normalizeScanRootPaths(rawScanRoots),
      maxScanDepth: Number.isSafeInteger(depth) && depth >= 0 ? depth : 0,
      scanTimeoutMs: typeof scanTimeout === 'number' ? scanTimeout : null,
      npmCommandTimeoutMs: typeof npmTimeout === 'number' ? npmTimeout : null,
    };

    const mode = configService.get<string>('MODE');
    const host = configService.get<string>('HOST');
    const port = Number(configService.get<number>('PORT') ?? 24681);
    const prefix = configService.get<string>('GLOBAL_PREFIX') || 'api';
    const version = configService.get<string>('VERSION') || '1';
    const cors =
      configService.get<string>('LIST_ORIGIN_CORS') ?? 'http://localhost:24680';
    const swagger = configService.get<boolean>('EXPORT_SWAGGER_API_JSON');

    this.startupServer = Object.freeze({
      mode: mode === 'production' ? 'production' : 'development',
      host:
        host === 'localhost' || host === '::1' || host === '127.0.0.1'
          ? host
          : '127.0.0.1',
      port: Number.isSafeInteger(port) ? port : 24681,
      globalPrefix: prefix,
      version,
      listOriginCors: cors,
      exportSwaggerApiJson: swagger !== false,
    });
  }

  getRuntimeSnapshot(): IRuntimeSettings {
    return { ...this.runtime };
  }

  getScanRootPathsRaw(): string {
    return this.runtime.scanRootPaths;
  }

  getScanRoots(platform: PathPlatform = toPathPlatform()): ScanRoots {
    return parseScanRootPaths(this.runtime.scanRootPaths, platform);
  }

  getMaxScanDepth(): number {
    return this.runtime.maxScanDepth;
  }

  getScanTimeoutMs(): number | undefined {
    return this.runtime.scanTimeoutMs ?? undefined;
  }

  getNpmCommandTimeoutMs(): number | undefined {
    return this.runtime.npmCommandTimeoutMs ?? undefined;
  }

  getStartupServerConfig(): Readonly<IServerSettings> {
    return this.startupServer;
  }

  getStartupEnvOnly():
    Readonly<Record<string, string | undefined>> | undefined {
    return this.startupEnvOnly;
  }

  applyRuntimeUpdate(next: IRuntimeSettings): void {
    this.runtime = {
      scanRootPaths: next.scanRootPaths,
      maxScanDepth: next.maxScanDepth,
      scanTimeoutMs: next.scanTimeoutMs,
      npmCommandTimeoutMs: next.npmCommandTimeoutMs,
    };
  }
}
