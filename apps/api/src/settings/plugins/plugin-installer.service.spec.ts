import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { ValidationException } from '@/common/exceptions/app.exception';
import type { AppPathsService } from '@/core/app-paths/app-paths.service';
import type { AuditLogService } from '@/core/audit-log/audit-log.service';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import type { PathGuardService } from '@/core/path-guard/path-guard.service';
import {
  hasMatchingMediaMagic,
  isForbiddenIpAddress,
  PluginInstallerService,
} from '@/settings/plugins/plugin-installer.service';
import { PluginRegistryService } from '@/settings/plugins/plugin-registry.service';
import { DEFAULT_PLUGINS_SETTINGS } from '@/settings/schema/settings.schema';

function makeSimpleZip(files: { name: string; content: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = deflateRawSync(f.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(f.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }
  const cBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cBuf, eocd]);
}

function makeSimpleTarGz(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, name.length, 'utf8');
  header.write('0000644\0', 100, 8, 'utf8');
  header.write('0000000\0', 108, 8, 'utf8');
  header.write('0000000\0', 116, 8, 'utf8');
  header.write(
    `${content.length.toString(8).padStart(11, '0')}\0`,
    124,
    12,
    'utf8',
  );
  header.write('00000000000\0', 136, 12, 'utf8');
  header.fill(32, 148, 156);
  header.write('0', 156, 1, 'utf8');
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i];
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  const rem = content.length % 512;
  const padded =
    rem === 0 ? content : Buffer.concat([content, Buffer.alloc(512 - rem)]);
  return gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)]));
}

describe('PluginInstallerService', () => {
  let root: string;
  let pluginsDir: string;
  let installer: PluginInstallerService;
  let registry: PluginRegistryService;
  let auditLog: { append: jest.Mock };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pkgsteward-installer-'));
    pluginsDir = join(root, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    const appPaths = { pluginsDir } as AppPathsService;
    const pathGuard = {
      isInsideProtectedTree: jest.fn(() => Promise.resolve(false)),
      findDenyReason: jest.fn(() => Promise.resolve(null)),
    } as unknown as PathGuardService;
    registry = new PluginRegistryService(appPaths, pathGuard);
    auditLog = { append: jest.fn(() => Promise.resolve()) };
    installer = new PluginInstallerService(
      registry,
      pathGuard,
      auditLog as unknown as AuditLogService,
      new MutationGateService(),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('does not inspect byte properties on non-Buffer media', () => {
    const input = {
      get length(): number {
        throw new Error('must not inspect non-Buffer input');
      },
    };
    expect(hasMatchingMediaMagic('photo.png', input)).toBe(false);
  });

  it('rejects non-Buffer uploads before reading them', async () => {
    const input = {
      get length(): number {
        throw new Error('must not inspect non-Buffer input');
      },
    } as unknown as Buffer;
    await expect(
      installer.previewInstallFromFile(
        DEFAULT_PLUGINS_SETTINGS,
        'plugin.zip',
        input,
      ),
    ).rejects.toThrow(ValidationException);
    await expect(
      installer.saveWallpaperMedia(
        DEFAULT_PLUGINS_SETTINGS,
        'photo.png',
        input,
      ),
    ).rejects.toThrow(ValidationException);
  });

  it('blocks private, loopback, metadata, and IPv4-mapped IPv6 addresses in SSRF guard', async () => {
    expect(isForbiddenIpAddress('127.0.0.1')).toBe(true);
    expect(isForbiddenIpAddress('169.254.169.254')).toBe(true);
    expect(isForbiddenIpAddress('10.1.2.3')).toBe(true);
    expect(isForbiddenIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isForbiddenIpAddress('::ffff:7f00:0001')).toBe(true);
    expect(isForbiddenIpAddress('fe81::1')).toBe(true);
    expect(isForbiddenIpAddress('febf::dead:beef')).toBe(true);
    expect(isForbiddenIpAddress('::7f00:1')).toBe(true);
    expect(isForbiddenIpAddress('64:ff9b::127.0.0.1')).toBe(true);
    expect(isForbiddenIpAddress('2002:7f00:0001::')).toBe(true);
    expect(isForbiddenIpAddress('93.184.216.34')).toBe(false);
    expect(isForbiddenIpAddress('2606:4700:4700::1111')).toBe(false);

    installer.setNetworkAdaptersForTest({
      lookup: jest.fn(() => Promise.resolve([{ address: '192.168.1.50' }])),
    });
    await expect(
      installer.previewInstallFromUrl(
        { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
        'https://internal.evil.example/plugin.zip',
      ),
    ).rejects.toThrow(ValidationException);
  });

  it('uses the approved IP for HTTPS but keeps the original Host and TLS identity', async () => {
    const request = jest.spyOn(https, 'request').mockImplementation(() => {
      throw new Error('stop before connecting');
    });
    try {
      installer.setNetworkAdaptersForTest({
        lookup: () => Promise.resolve([{ address: '93.184.216.34' }]),
      });
      await expect(
        installer.previewInstallFromUrl(
          DEFAULT_PLUGINS_SETTINGS,
          'https://plugins.example:8443/sample.zip?rev=1',
        ),
      ).rejects.toThrow('stop before connecting');
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: '93.184.216.34',
          port: 8443,
          path: '/sample.zip?rev=1',
          servername: 'plugins.example',
          rejectUnauthorized: true,
          headers: {
            Host: 'plugins.example:8443',
            'User-Agent': 'PkgSteward-PluginInstaller/1.0',
          },
        }),
        expect.any(Function),
      );
    } finally {
      request.mockRestore();
    }
  });

  it('rejects a lookup result without a usable address before downloading', async () => {
    const fetchMock = jest.fn(() =>
      Promise.reject(new Error('unexpected download')),
    );
    installer.setNetworkAdaptersForTest({
      lookup: () => Promise.resolve([{ address: ' 93.184.216.34 ' }]),
      fetchImpl: fetchMock,
    });
    await expect(
      installer.previewInstallFromUrl(
        DEFAULT_PLUGINS_SETTINGS,
        'https://plugins.example/sample.zip',
      ),
    ).rejects.toThrow(ValidationException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a newly approved HTTPS address after a redirect', async () => {
    const lookup = jest.fn((host: string) =>
      Promise.resolve([
        { address: host === 'plugins.example' ? '93.184.216.34' : '8.8.8.8' },
      ]),
    );
    installer.setNetworkAdaptersForTest({ lookup });

    const request = jest
      .spyOn(https, 'request')
      .mockImplementation((...args: unknown[]) => {
        const [options, respond] = args as [
          https.RequestOptions,
          (res: EventEmitter) => void,
        ];
        const redirect = options.servername === 'plugins.example';
        const response = Object.assign(new EventEmitter(), {
          statusCode: redirect ? 302 : 404,
          headers: redirect
            ? { location: 'https://download.example/sample.zip' }
            : {},
        });
        return Object.assign(new EventEmitter(), {
          end: () => {
            respond(response);
            response.emit('end');
          },
        }) as ReturnType<typeof https.request>;
      });
    try {
      await expect(
        installer.previewInstallFromUrl(
          DEFAULT_PLUGINS_SETTINGS,
          'https://plugins.example/sample.zip',
        ),
      ).rejects.toThrow('Remote plugin download failed with HTTP 404');
      expect(lookup).toHaveBeenLastCalledWith('download.example');
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          hostname: '8.8.8.8',
          servername: 'download.example',
          path: '/sample.zip',
        }),
        expect.any(Function),
      );
    } finally {
      request.mockRestore();
    }
  });

  it('installs a Wallpaper Engine ZIP via preview -> confirm with high-risk ack and uninstalls cleanly', async () => {
    const zip = makeSimpleZip([
      {
        name: 'aurora-shader/project.json',
        content: Buffer.from(
          JSON.stringify({
            title: 'Aurora Shader',
            type: 'web',
            file: 'index.html',
          }),
        ),
      },
      {
        name: 'aurora-shader/index.html',
        content: Buffer.from(
          '<html><head></head><body><canvas/></body></html>',
        ),
      },
    ]);

    const preview = await installer.previewInstallFromFile(
      { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
      'aurora.zip',
      zip,
    );
    expect(preview.pluginId).toBe('aurora-shader');
    expect(preview.format).toBe('project.json');
    expect(preview.risk.level).toBe('high');
    expect(preview.risk.reasons.map((r) => r.code)).toContain(
      'PLUGIN_SANDBOX_SCRIPT',
    );

    await expect(
      installer.executeInstall(
        { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
        { previewId: preview.previewId, confirm: true, acknowledgedRisks: [] },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(ValidationException);

    const afterInstall = jest.fn(() => Promise.resolve());
    const installed = await installer.executeInstall(
      { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
      {
        previewId: preview.previewId,
        confirm: true,
        acknowledgedRisks: ['PLUGIN_SANDBOX_SCRIPT'],
      },
      afterInstall,
    );
    expect(installed.pluginId).toBe('aurora-shader');
    expect(existsSync(join(pluginsDir, 'aurora-shader', 'index.html'))).toBe(
      true,
    );
    expect(auditLog.append).toHaveBeenCalledTimes(2);

    const sandboxDoc = await registry.buildSandboxedHtmlDocument(
      {
        ...DEFAULT_PLUGINS_SETTINGS,
        trustedRegistries: [],
        entries: {
          'aurora-shader': { enabled: true, config: {} },
        },
      },
      'aurora-shader',
    );
    expect(sandboxDoc.html).toContain("connect-src 'none'");

    const uninstallPreview = await installer.previewUninstall(
      { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
      'aurora-shader',
    );
    await installer.executeUninstall(
      { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
      { previewId: uninstallPreview.previewId, confirm: true },
      () => Promise.resolve(),
    );
    expect(existsSync(join(pluginsDir, 'aurora-shader'))).toBe(false);
  });

  it('installs npm: package from mocked safe public endpoint and verifies redirect hops', async () => {
    const tgz = makeSimpleTarGz(
      'package/package.json',
      Buffer.from(
        JSON.stringify({
          name: 'demo-community-plugin',
          version: '1.2.3',
          description: 'Mock npm plugin',
        }),
      ),
    );
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        arrayBuffer: () =>
          Promise.resolve(
            Buffer.from(
              JSON.stringify({
                dist: {
                  tarball: 'https://registry.npmjs.org/demo/-/demo-1.2.3.tgz',
                },
              }),
            ),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        arrayBuffer: () => Promise.resolve(tgz),
      });

    installer.setNetworkAdaptersForTest({
      lookup: jest.fn(() => Promise.resolve([{ address: '104.16.25.34' }])),
      fetchImpl: fetchMock as typeof fetch,
    });

    const preview = await installer.previewInstallFromUrl(
      { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
      'npm:demo-community-plugin',
    );
    expect(preview.pluginId).toBe('demo-community-plugin');
    expect(preview.format).toBe('package.json');
    expect(preview.risk.reasons.map((r) => r.code)).toContain(
      'PLUGIN_INSTALL_REMOTE',
    );
  });

  it('saves valid wallpaper PNG with magic byte verification and rejects spoofed files', async () => {
    const fakePng = Buffer.from('NOT_A_PNG_FILE_CONTENT');
    await expect(
      installer.saveWallpaperMedia(
        { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
        'bg.png',
        fakePng,
      ),
    ).rejects.toThrow(ValidationException);

    const realPngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const saved = await installer.saveWallpaperMedia(
      { ...DEFAULT_PLUGINS_SETTINGS, trustedRegistries: [] },
      'bg.png',
      realPngHeader,
    );
    expect(saved).toEqual({
      assetPath: 'assets/custom-wallpaper.png',
      mediaType: 'image',
    });
    expect(
      existsSync(
        join(pluginsDir, 'wallpaper-engine', 'assets', 'custom-wallpaper.png'),
      ),
    ).toBe(true);
  });
});
