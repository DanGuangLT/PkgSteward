import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadAppConfig,
  mergeConfigSources,
  readSettingsFile,
} from '@/config/config-loader';

describe('mergeConfigSources', () => {
  it('applies CLI over settings.json over env', () => {
    expect(
      mergeConfigSources({
        env: { A: 'env', B: 'env', C: 'env' },
        settings: { B: 'settings', C: 'settings' },
        cli: { C: 'cli' },
      }),
    ).toEqual({ A: 'env', B: 'settings', C: 'cli' });
  });
  it('never lets an undefined value erase a lower source', () => {
    expect(
      mergeConfigSources({
        env: { A: 'env' },
        settings: { A: undefined },
        cli: {},
      }),
    ).toEqual({ A: 'env' });
  });
});

describe('readSettingsFile', () => {
  const file = 'C:\\data\\settings.json';
  const from = (content: string) => () => content;

  it('returns {} when the file does not exist', () => {
    const missing = () => {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    };
    expect(readSettingsFile(file, missing)).toEqual({});
  });
  it('reads a flat JSON object', () =>
    expect(
      readSettingsFile(file, from('{"MAX_SCAN_DEPTH": 3, "HOST": "::1"}')),
    ).toEqual({
      MAX_SCAN_DEPTH: 3,
      HOST: '::1',
    }));
  it('accepts a UTF-8 BOM (Notepad)', () =>
    expect(readSettingsFile(file, from('\uFEFF{"PORT": 25000}'))).toEqual({
      PORT: 25000,
    }));
  it.each([
    ['{oops', /Invalid JSON in settings file C:\\data\\settings\.json/],
    ['[1]', /must contain a flat JSON object/],
    ['null', /must contain a flat JSON object/],
    ['{"PORT": {"x": 1}}', /"PORT" must be a string, number or boolean/],
    ['{"SCAN_ROOT_PATH": "D:\\\\x"}', /unknown key "SCAN_ROOT_PATH"/],
    [
      '{"PKGSTEWARD_DATA_DIR": "D:\\\\x"}',
      /PKGSTEWARD_DATA_DIR cannot be set in settings\.json/,
    ],
  ])('rejects %s and names the file', (content, message) =>
    expect(() => readSettingsFile(file, from(content))).toThrow(message),
  );
  it('reports unreadable files with their path', () => {
    const denied = () => {
      throw Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      });
    };
    expect(() => readSettingsFile(file, denied)).toThrow(
      /Cannot read settings file C:\\data\\settings\.json/,
    );
  });
});

describe('loadAppConfig', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pkgsteward-config-'));
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const writeSettings = (content: object | string) =>
    writeFileSync(
      join(dataDir, 'settings.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );

  it('fills defaults when no source sets a value', () => {
    const config = loadAppConfig({ env: { PKGSTEWARD_DATA_DIR: dataDir } });
    expect(config.SCAN_TIMEOUT_MS).toBe(900000);
    expect(config.SCAN_ROOT_PATHS).toBe('*');
  });
  it('lets settings.json override env', () => {
    writeSettings({ MAX_SCAN_DEPTH: 3, PORT: 25000 });
    const config = loadAppConfig({
      env: { PKGSTEWARD_DATA_DIR: dataDir, MAX_SCAN_DEPTH: '7' },
    });
    expect(config.MAX_SCAN_DEPTH).toBe(3);
    expect(config.PORT).toBe(25000);
  });
  it('lets CLI override settings.json', () => {
    writeSettings({ MAX_SCAN_DEPTH: 3 });
    const config = loadAppConfig({
      env: { PKGSTEWARD_DATA_DIR: dataDir },
      cli: { MAX_SCAN_DEPTH: 5 },
    });
    expect(config.MAX_SCAN_DEPTH).toBe(5);
  });
  it('fails start-up on a corrupt settings.json and names the file', () => {
    writeSettings('{oops');
    expect(() =>
      loadAppConfig({ env: { PKGSTEWARD_DATA_DIR: dataDir } }),
    ).toThrow('settings.json');
  });
  it('validates values coming from settings.json', () => {
    writeSettings({ MAX_SCAN_DEPTH: -1 });
    expect(() =>
      loadAppConfig({ env: { PKGSTEWARD_DATA_DIR: dataDir } }),
    ).toThrow(/MAX_SCAN_DEPTH/);
  });
  it('rejects a relative PKGSTEWARD_DATA_DIR before touching the disk', () => {
    const readFile = jest.fn();
    expect(() =>
      loadAppConfig({ env: { PKGSTEWARD_DATA_DIR: 'data' }, readFile }),
    ).toThrow(/PKGSTEWARD_DATA_DIR must be an absolute path/);
    expect(readFile).not.toHaveBeenCalled();
  });
  it('reads settings.json from %LOCALAPPDATA%\\PkgSteward when no override is set', () => {
    const readFile = jest.fn(() => {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' });
    });
    loadAppConfig({
      env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' },
      platform: 'win32',
      homeDir: 'C:\\Users\\a',
      readFile,
    });
    expect(readFile).toHaveBeenCalledWith(
      'C:\\Users\\a\\AppData\\Local\\PkgSteward\\settings.json',
    );
  });
});
