import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RuntimeConfigModule } from '@/core/runtime-config/runtime-config.module';
import { RuntimeConfigService } from '@/core/runtime-config/runtime-config.service';

@Injectable()
class RuntimeConsumer {
  constructor(readonly runtime: RuntimeConfigService) {}
}

@Module({ providers: [RuntimeConsumer] })
class RuntimeConsumerModule {}

describe('RuntimeConfigService', () => {
  it('initializes runtime and immutable startup server snapshots from ConfigService', () => {
    const config = new ConfigService({
      SCAN_ROOT_PATHS: 'D:\\Projects',
      MAX_SCAN_DEPTH: 4,
      SCAN_TIMEOUT_MS: 5000,
      NPM_COMMAND_TIMEOUT_MS: 12000,
      MODE: 'production',
      HOST: 'localhost',
      PORT: 24999,
      GLOBAL_PREFIX: 'api',
      VERSION: '2',
      LIST_ORIGIN_CORS: 'http://localhost:24680',
      EXPORT_SWAGGER_API_JSON: false,
    });
    const service = new RuntimeConfigService(config);

    expect(service.getRuntimeSnapshot()).toEqual({
      scanRootPaths: 'D:\\Projects',
      maxScanDepth: 4,
      scanTimeoutMs: 5000,
      npmCommandTimeoutMs: 12000,
    });
    expect(service.getScanRoots('win32')).toEqual({
      kind: 'paths',
      paths: ['D:\\Projects'],
    });
    expect(service.getStartupServerConfig()).toEqual({
      mode: 'production',
      host: 'localhost',
      port: 24999,
      globalPrefix: 'api',
      version: '2',
      listOriginCors: 'http://localhost:24680',
      exportSwaggerApiJson: false,
    });

    service.applyRuntimeUpdate({
      scanRootPaths: '*',
      maxScanDepth: 0,
      scanTimeoutMs: null,
      npmCommandTimeoutMs: 30000,
    });
    expect(service.getScanRootPathsRaw()).toBe('*');
    expect(service.getMaxScanDepth()).toBe(0);
    expect(service.getScanTimeoutMs()).toBeUndefined();
    expect(service.getNpmCommandTimeoutMs()).toBe(30000);
  });

  it('exports globally to consumer modules', async () => {
    @Global()
    @Module({
      providers: [{ provide: ConfigService, useValue: new ConfigService({}) }],
      exports: [ConfigService],
    })
    class TestConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestConfigModule, RuntimeConfigModule, RuntimeConsumerModule],
    }).compile();

    try {
      const consumer = moduleRef
        .select(RuntimeConsumerModule)
        .get(RuntimeConsumer, { strict: true });
      expect(consumer.runtime).toBe(moduleRef.get(RuntimeConfigService));
      expect(consumer.runtime.getScanRootPathsRaw()).toBe('*');
    } finally {
      await moduleRef.close();
    }
  });
});
