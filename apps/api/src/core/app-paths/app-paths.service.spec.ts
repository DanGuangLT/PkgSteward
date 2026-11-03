import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import { AppPathsModule } from '@/core/app-paths/app-paths.module';
import { resolveDataDir } from '@/core/app-paths/app-paths.util';

const fakeConfig = (dataDir?: string) =>
  ({
    get: jest.fn((key: string) =>
      key === 'PKGSTEWARD_DATA_DIR' ? dataDir : undefined,
    ),
  }) as unknown as ConfigService;

@Injectable()
class PathsConsumer {
  constructor(readonly paths: AppPathsService) {}
}

@Module({ providers: [PathsConsumer] })
class PathsConsumerModule {}

describe('AppPathsService', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pkgsteward-data-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('places every runtime file under PKGSTEWARD_DATA_DIR', () => {
    const paths = new AppPathsService(fakeConfig(tmp));
    expect(paths.dataDir).toBe(tmp);
    expect(paths.logsDir).toBe(join(tmp, 'logs'));
    expect(paths.cacheDir).toBe(join(tmp, 'cache'));
    expect(paths.settingsFilePath).toBe(join(tmp, 'settings.json'));
    expect(paths.auditLogFilePath).toBe(
      join(tmp, 'logs', 'dangerous-operations.jsonl'),
    );
  });

  it('creates nothing until a folder is requested', () => {
    new AppPathsService(fakeConfig(join(tmp, 'data')));
    expect(existsSync(join(tmp, 'data'))).toBe(false);
  });

  it('creates logs/ and cache/ lazily and idempotently', async () => {
    const paths = new AppPathsService(fakeConfig(join(tmp, 'data')));
    await expect(paths.ensureDir('logs')).resolves.toBe(
      join(tmp, 'data', 'logs'),
    );
    await expect(paths.ensureDir('logs')).resolves.toBe(
      join(tmp, 'data', 'logs'),
    );
    await expect(paths.ensureDir('cache')).resolves.toBe(
      join(tmp, 'data', 'cache'),
    );
    expect(existsSync(join(tmp, 'data', 'logs'))).toBe(true);
    expect(existsSync(join(tmp, 'data', 'cache'))).toBe(true);
  });

  it('derives appInstallDir from the backend package, not from cwd', () => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const paths = new AppPathsService(fakeConfig(tmp));
      const pkg = JSON.parse(
        readFileSync(join(paths.appInstallDir, 'package.json'), 'utf8'),
      ) as { name: string };
      expect(pkg.name).toBe('@pkgsteward/api');
    } finally {
      process.chdir(cwd);
    }
  });

  it('falls back to %LOCALAPPDATA%\\PkgSteward when PKGSTEWARD_DATA_DIR is unset', () => {
    const paths = new AppPathsService(fakeConfig(undefined));
    expect(paths.dataDir).toBe(
      resolveDataDir({
        localAppData: process.env.LOCALAPPDATA,
        homeDir: homedir(),
        platform: process.platform,
      }),
    );
  });

  it('exports one globally injectable service to a module without a direct import', async () => {
    @Global()
    @Module({
      providers: [
        { provide: ConfigService, useValue: fakeConfig(join(tmp, 'data')) },
      ],
      exports: [ConfigService],
    })
    class TestConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestConfigModule, AppPathsModule, PathsConsumerModule],
    }).compile();

    try {
      const consumer = moduleRef
        .select(PathsConsumerModule)
        .get(PathsConsumer, { strict: true });
      expect(consumer.paths).toBe(moduleRef.get(AppPathsService));
      expect(consumer.paths.dataDir).toBe(join(tmp, 'data'));
      expect(existsSync(join(tmp, 'data'))).toBe(false);
    } finally {
      await moduleRef.close();
    }
  });
});
