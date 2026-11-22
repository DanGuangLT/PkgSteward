import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConflictException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type { AppPathsService } from '@/core/app-paths/app-paths.service';
import type { AuditLogService } from '@/core/audit-log/audit-log.service';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import type { PathGuardService } from '@/core/path-guard/path-guard.service';
import { RuntimeConfigService } from '@/core/runtime-config/runtime-config.service';
import type { DiskUsageService } from '@/disk-usage/disk-usage.service';
import type { FileOpsService } from '@/file-ops/file-ops.service';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';
import type { ProjectsService } from '@/projects/projects.service';
import type { ScannerService } from '@/scanner/scanner.service';
import { PluginInstallerService } from '@/settings/plugins/plugin-installer.service';
import { PluginRegistryService } from '@/settings/plugins/plugin-registry.service';
import { SettingsService } from '@/settings/settings.service';

describe('SettingsService', () => {
  let root: string;

  const createFixture = (env: Record<string, string | undefined> = {}) => {
    const dataDir = join(root, 'data');
    const appPaths = {
      dataDir,
      logsDir: join(dataDir, 'logs'),
      cacheDir: join(dataDir, 'cache'),
      pluginsDir: join(dataDir, 'plugins'),
      settingsFilePath: join(dataDir, 'settings.json'),
      auditLogFilePath: join(dataDir, 'logs', 'dangerous-operations.jsonl'),
      appInstallDir: join(root, 'app'),
      sourceCheckoutDir: root,
    } as AppPathsService;

    const runtimeConfig = new RuntimeConfigService(
      new ConfigService({
        SCAN_ROOT_PATHS: env.SCAN_ROOT_PATHS ?? '*',
        MAX_SCAN_DEPTH: env.MAX_SCAN_DEPTH ? Number(env.MAX_SCAN_DEPTH) : 0,
        HOST: env.HOST ?? '127.0.0.1',
        PORT: env.PORT ? Number(env.PORT) : 24681,
      }),
    );
    const pathGuard = {
      reloadScanRoots: jest.fn(),
      isInsideProtectedTree: jest.fn((p: string) =>
        Promise.resolve(p.toLowerCase().includes('windows')),
      ),
      findDenyReason: jest.fn((p: string) => {
        const lower = p.trim().toLowerCase();
        if (
          lower.includes('windows') ||
          /^[a-z]:\\?$/.test(lower) ||
          lower === '/'
        ) {
          return Promise.resolve('protected system location');
        }
        return Promise.resolve(null);
      }),
    };
    const auditLog = {
      append: jest.fn((record: unknown) => {
        void record;
        return Promise.resolve();
      }),
    };
    const gate = new MutationGateService();
    const scanner = {
      hasRunningScan: jest.fn(() => false),
      invalidateForConfigChange: jest.fn(() => Promise.resolve()),
    };
    const diskUsage = {
      hasRunningMeasurement: jest.fn(() => false),
      clearCache: jest.fn(),
    };
    const fileOps = {
      hasRunningPreview: jest.fn(() => false),
    };
    const projects = {
      hasRunningAnalysis: jest.fn(() => false),
      invalidateAllAfterMutation: jest.fn(),
    };
    const pluginRegistry = new PluginRegistryService(
      appPaths,
      pathGuard as unknown as PathGuardService,
    );
    const pluginInstaller = new PluginInstallerService(
      pluginRegistry,
      pathGuard as unknown as PathGuardService,
      auditLog as unknown as AuditLogService,
      gate,
    );
    const driveDetector: IDriveDetector = {
      listFixedDrives: jest.fn(() => Promise.resolve(['C:\\', 'D:\\'])),
    };

    const service = new SettingsService(
      appPaths,
      runtimeConfig,
      pathGuard as unknown as PathGuardService,
      auditLog as unknown as AuditLogService,
      gate,
      scanner as unknown as ScannerService,
      diskUsage as unknown as DiskUsageService,
      fileOps as unknown as FileOpsService,
      projects as unknown as ProjectsService,
      pluginRegistry,
      pluginInstaller,
      driveDetector,
      env,
    );

    return {
      service,
      appPaths,
      runtimeConfig,
      pathGuard,
      auditLog,
      gate,
      scanner,
      diskUsage,
      fileOps,
      projects,
      pluginRegistry,
      pluginInstaller,
      driveDetector,
    };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pkgsteward-settings-unit-'));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('tracks accurate value sources (env vs default vs settings) and preserves env when saving UI preferences', async () => {
    const f = createFixture({ SCAN_ROOT_PATHS: join(root, 'Projects') });
    const initial = await f.service.getSnapshot();
    expect(initial.document.runtime.scanRootPaths).toBe(join(root, 'Projects'));
    expect(initial.sources.runtime.scanRootPaths).toBe('env');
    expect(initial.sources.runtime.maxScanDepth).toBe('default');

    const updated = await f.service.updatePreferences({
      appearance: {
        themePreset: 'ocean',
        fontFamily: 'be-vietnam-pro',
        navigationLayout: 'sidebar',
      },
      behavior: { defaultPageSize: 50 },
    });

    expect(updated.document.appearance.themePreset).toBe('ocean');
    expect(updated.document.appearance.navigationLayout).toBe('sidebar');
    expect(updated.document.behavior.defaultPageSize).toBe(50);
    // Env override must still be preserved because runtime was untouched
    expect(updated.document.runtime.scanRootPaths).toBe(join(root, 'Projects'));
    expect(updated.sources.runtime.scanRootPaths).toBe('env');

    const rawOnDisk = JSON.parse(
      readFileSync(f.appPaths.settingsFilePath, 'utf8'),
    ) as Record<string, unknown>;
    expect(rawOnDisk).not.toHaveProperty('runtime');
  });

  it('rejects privileged runtime/server/plugin-dir fields on PATCH /settings/preferences', async () => {
    const f = createFixture();
    await expect(
      f.service.updatePreferences({ runtime: { scanRootPaths: 'D:\\x' } }),
    ).rejects.toThrow(ValidationException);
    await expect(
      f.service.updatePreferences({ server: { port: 9999 } }),
    ).rejects.toThrow(ValidationException);
    await expect(
      f.service.updatePreferences({ plugins: { allowLocalPlugins: true } }),
    ).rejects.toThrow(ValidationException);
  });

  it('enforces Tier B preview -> confirm -> risk ack, reloads PathGuard & RuntimeConfig, invalidates caches, and writes intent+result audit log', async () => {
    const f = createFixture({ SCAN_ROOT_PATHS: join(root, 'Work') });

    // Expanding back to "*" carries BROAD_SCAN_ROOTS high risk
    const preview = await f.service.previewUpdate({
      runtime: { scanRootPaths: '*', npmCommandTimeoutMs: 15000 },
      server: { port: 24999 },
    });
    expect(preview.clearsScanCache).toBe(true);
    expect(preview.risk.level).toBe('high');
    expect(preview.risk.reasons.map((r) => r.code)).toContain(
      'BROAD_SCAN_ROOTS',
    );
    expect(preview.restartRequiredFields).toContain('server.port');

    // Missing confirm or missing risk ack fails cleanly
    await expect(
      f.service.executePreviewedAction('update', {
        previewId: preview.previewId,
        confirm: false,
      }),
    ).rejects.toThrow(ValidationException);
    await expect(
      f.service.executePreviewedAction('update', {
        previewId: preview.previewId,
        confirm: true,
        acknowledgedRisks: [],
      }),
    ).rejects.toThrow(ValidationException);

    const applied = await f.service.executePreviewedAction('update', {
      previewId: preview.previewId,
      confirm: true,
      acknowledgedRisks: ['BROAD_SCAN_ROOTS'],
    });

    expect(applied.document.runtime.scanRootPaths).toBe('*');
    expect(applied.sources.runtime.scanRootPaths).toBe('settings');
    expect(applied.restartRequiredFields).toEqual(['port']);
    expect(f.runtimeConfig.getNpmCommandTimeoutMs()).toBe(15000);
    expect(f.pathGuard.reloadScanRoots).toHaveBeenCalledWith('*');
    expect(f.scanner.invalidateForConfigChange).toHaveBeenCalledTimes(1);
    expect(f.diskUsage.clearCache).toHaveBeenCalledTimes(1);
    expect(f.projects.invalidateAllAfterMutation).toHaveBeenCalledTimes(1);
    expect(f.auditLog.append).toHaveBeenCalledTimes(2);
    expect(f.auditLog.append.mock.calls[0][0]).toMatchObject({
      operation: 'settings.update',
      phase: 'intent',
    });
    expect(f.auditLog.append.mock.calls[1][0]).toMatchObject({
      operation: 'settings.update',
      phase: 'result',
      result: 'completed',
    });

    // Replay of consumed preview fails
    await expect(
      f.service.executePreviewedAction('update', {
        previewId: preview.previewId,
        confirm: true,
        acknowledgedRisks: ['BROAD_SCAN_ROOTS'],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('blocks Tier B execute with 409 CONFLICT when MutationGate or a running job is active', async () => {
    const f = createFixture({ SCAN_ROOT_PATHS: join(root, 'Initial') });
    const preview = await f.service.previewUpdate({
      runtime: { maxScanDepth: 2 },
    });

    f.scanner.hasRunningScan.mockReturnValueOnce(true);
    await expect(
      f.service.executePreviewedAction('update', {
        previewId: preview.previewId,
        confirm: true,
      }),
    ).rejects.toThrow(ConflictException);
    expect(f.gate.isBusy()).toBe(false);

    const token = f.gate.tryEnter()!;
    await expect(
      f.service.executePreviewedAction('update', {
        previewId: preview.previewId,
        confirm: true,
      }),
    ).rejects.toThrow(ConflictException);
    f.gate.leave(token);
  });

  it('blocks protected plugin directories and supports export/import (including legacy flat) & reset flows', async () => {
    const f = createFixture();
    const protectedDir =
      process.platform === 'win32'
        ? 'C:\\Windows\\Plugins'
        : join(root, 'fake-windows-dir', 'plugins');
    await expect(
      f.service.previewUpdate({ plugins: { directory: protectedDir } }),
    ).rejects.toThrow(
      'plugins.directory cannot point inside a protected system or application directory',
    );

    // Legacy flat import preview + execute
    const importPreview = await f.service.previewImport({
      SCAN_ROOT_PATHS: join(root, 'LegacyRoot'),
      MAX_SCAN_DEPTH: 3,
      PORT: 24700,
    });
    expect(importPreview.action).toBe('import');
    expect(importPreview.clearsScanCache).toBe(true);
    const imported = await f.service.executePreviewedAction('import', {
      previewId: importPreview.previewId,
      confirm: true,
    });
    expect(imported.document.runtime.scanRootPaths).toBe(
      join(root, 'LegacyRoot'),
    );
    expect(imported.restartRequiredFields).toContain('port');

    // Reset appearance + runtime (widens the legacy scan root back to '*' -> high risk)
    await f.service.updatePreferences({ appearance: { themePreset: 'slate' } });
    const resetPreview = await f.service.previewReset('all');
    expect(resetPreview.action).toBe('reset');
    expect(resetPreview.risk.reasons.map((r) => r.code)).toContain(
      'BROAD_SCAN_ROOTS',
    );
    const afterReset = await f.service.executePreviewedAction('reset', {
      previewId: resetPreview.previewId,
      confirm: true,
      acknowledgedRisks: ['BROAD_SCAN_ROOTS'],
    });
    expect(afterReset.document.appearance.themePreset).toBe('default');
    expect(afterReset.document.runtime.scanRootPaths).toBe('*');
  });

  it('migrates legacy flat settings.json on disk cleanly during updatePreferences', async () => {
    const f = createFixture();
    const fs = await import('node:fs');
    fs.mkdirSync(f.appPaths.dataDir, { recursive: true });
    writeFileSync(
      f.appPaths.settingsFilePath,
      JSON.stringify({ MAX_SCAN_DEPTH: 5 }),
    );
    const snap = await f.service.updatePreferences({
      appearance: { fontScale: 110 },
    });
    expect(snap.document.runtime.maxScanDepth).toBe(5);
    expect(snap.document.appearance.fontScale).toBe(110);
  });

  it('normalizes comma-only scanRootPaths to "*" with BROAD_SCAN_ROOTS risk and blocks junctions targeting protected dirs', async () => {
    const f = createFixture({ SCAN_ROOT_PATHS: join(root, 'Work') });
    const preview = await f.service.previewUpdate({
      runtime: { scanRootPaths: ' , , ' },
    });
    expect(preview.targetDocument.runtime.scanRootPaths).toBe('*');
    expect(preview.risk.level).toBe('high');
    expect(preview.risk.reasons.map((r) => r.code)).toContain(
      'BROAD_SCAN_ROOTS',
    );

    const protectedTarget = join(root, 'fake-windows-dir');
    const junctionPath = join(root, 'safe-plugin-link');
    mkdirSync(protectedTarget, { recursive: true });
    symlinkSync(
      protectedTarget,
      junctionPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      f.service.previewUpdate({
        plugins: { directory: join(junctionPath, 'nested') },
      }),
    ).rejects.toThrow(
      'plugins.directory cannot resolve inside a protected system or application directory',
    );

    // Drive/filesystem root is blocked by findDenyReason
    await expect(
      f.service.previewUpdate({
        plugins: { directory: process.platform === 'win32' ? 'C:\\' : '/' },
      }),
    ).rejects.toThrow(ValidationException);

    // Merged key limit check returns ValidationException (400) rather than raw Error (500)
    const firstBatch = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, i]),
    );
    const secondBatch = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`m${i}`, i]),
    );
    await f.service.updatePreferences({ desktop: firstBatch });
    await expect(
      f.service.updatePreferences({ desktop: secondBatch }),
    ).rejects.toThrow(ValidationException);
  });

  it('includes availableDrives in snapshot and supports uninstalling/restoring preinstalled wallpaper plugin', async () => {
    const f = createFixture();
    await f.service.initializePreinstalledPlugins();
    const initial = await f.service.getSnapshot();
    expect(initial.availableDrives).toEqual(['C:\\', 'D:\\']);
    expect(
      initial.plugins.discovered.some((p) => p.id === 'wallpaper-engine'),
    ).toBe(true);
    expect(initial.plugins.preinstalledAvailable).toBe(false);

    const uninstallPreview =
      await f.service.previewPluginUninstall('wallpaper-engine');
    expect(uninstallPreview.preinstalled).toBe(true);

    const afterUninstall = await f.service.executePluginUninstall({
      previewId: uninstallPreview.previewId,
      confirm: true,
    });
    expect(
      afterUninstall.plugins.discovered.some(
        (p) => p.id === 'wallpaper-engine',
      ),
    ).toBe(false);
    expect(afterUninstall.plugins.preinstalledAvailable).toBe(true);
    expect(afterUninstall.document.plugins.removedPreinstalled).toContain(
      'wallpaper-engine',
    );

    // Calling initializePreinstalledPlugins again respects removedPreinstalled
    await f.service.initializePreinstalledPlugins();
    const stillRemoved = await f.service.getPluginsCatalog();
    expect(stillRemoved.discovered).toHaveLength(0);

    const restored = await f.service.restoreDefaultPlugins();
    expect(
      restored.plugins.discovered.some((p) => p.id === 'wallpaper-engine'),
    ).toBe(true);
    expect(restored.plugins.preinstalledAvailable).toBe(false);
  });
});
