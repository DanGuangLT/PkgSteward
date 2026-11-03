import { Global, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import type { AppDataSubdir } from '@/core/app-paths/interfaces/app-paths.service.interface';
import { AuditLogModule } from '@/core/audit-log/audit-log.module';
import { AuditLogService } from '@/core/audit-log/audit-log.service';
import type { IAuditRecord } from '@/core/audit-log/interfaces/audit-log.types';

@Injectable()
class AuditConsumer {
  constructor(readonly audit: AuditLogService) {}
}

@Module({ providers: [AuditConsumer] })
class AuditConsumerModule {}

function record(operationId = 'operation-1'): IAuditRecord {
  return {
    operation: 'file-ops.delete',
    operationId,
    phase: 'intent',
    targets: ['D:\\Projects\\example\\node_modules'],
    method: 'permanent',
    risk: { level: 'medium', codes: ['NO_LOCKFILE'] },
    result: 'started',
    errorCode: null,
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  return { promise, release };
}

describe('AuditLogService', () => {
  let tempDir: string;
  let logsDir: string;
  let appPaths: {
    auditLogFilePath: string;
    ensureDir: jest.Mock<Promise<string>, [AppDataSubdir]>;
  };
  let service: AuditLogService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pkgsteward-audit-test-'));
    logsDir = join(tempDir, 'logs');
    appPaths = {
      auditLogFilePath: join(logsDir, 'dangerous-operations.jsonl'),
      ensureDir: jest.fn(async (subdir: AppDataSubdir) => {
        const dir = join(tempDir, subdir);
        await mkdir(dir, { recursive: true });
        return dir;
      }),
    };
    service = new AuditLogService(appPaths as unknown as AppPathsService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // Only remove the directory created by this test, strictly under os.tmpdir().
    const relativePath = relative(resolve(tmpdir()), resolve(tempDir));
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(
        'Refusing to remove a path outside the test temporary directory',
      );
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  async function readRecords(): Promise<(IAuditRecord & { time: string })[]> {
    const contents = await readFile(appPaths.auditLogFilePath, 'utf8');
    expect(contents.endsWith('\n')).toBe(true);
    return contents
      .slice(0, -1)
      .split('\n')
      .map((line) => JSON.parse(line) as IAuditRecord & { time: string });
  }

  it('writes one complete JSON record with an ISO timestamp to the AppPaths location', async () => {
    const input = record();
    const before = Date.now();
    await service.append(input);
    const after = Date.now();
    const records = await readRecords();
    expect(records).toHaveLength(1);
    const { time, ...saved } = records[0];
    expect(saved).toEqual(input);
    expect(typeof time).toBe('string');
    expect(new Date(time).toISOString()).toBe(time);
    expect(Date.parse(time)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(time)).toBeLessThanOrEqual(after);
    expect(appPaths.ensureDir).toHaveBeenCalledTimes(1);
    expect(appPaths.ensureDir).toHaveBeenCalledWith('logs');
    expect(input).not.toHaveProperty('time');
  });

  it('writes simultaneous calls as separate lines in invocation order', async () => {
    const first = record('first');
    const second: IAuditRecord = {
      ...record('second'),
      phase: 'result',
      result: 'success',
    };
    const firstWrite = service.append(first);
    const secondWrite = service.append(second);
    await Promise.all([firstWrite, secondWrite]);
    const records = await readRecords();
    expect(records).toEqual([
      expect.objectContaining(first),
      expect.objectContaining(second),
    ]);
    expect(appPaths.ensureDir.mock.calls).toEqual([['logs'], ['logs']]);
  });

  it('does not let a queued call overtake a blocked first write', async () => {
    const gate = deferred();
    const entered = deferred();
    const createDirectory = appPaths.ensureDir.getMockImplementation()!;
    appPaths.ensureDir.mockImplementationOnce(async (subdir) => {
      entered.release();
      await gate.promise;
      return createDirectory(subdir);
    });
    const first = service.append(record('first'));
    const second = service.append(record('second'));
    const settled = Promise.allSettled([first, second]);
    try {
      // A stub/failure must reject this test immediately instead of timing out on entered.
      await Promise.race([entered.promise, first]);
      await new Promise<void>((done) => setImmediate(done));
      expect(appPaths.ensureDir).toHaveBeenCalledTimes(1);
    } finally {
      gate.release();
      await settled;
    }
    await Promise.all([first, second]);
    expect((await readRecords()).map(({ operationId }) => operationId)).toEqual(
      ['first', 'second'],
    );
  });

  it('escapes newlines, quotes, backslashes and Unicode within a single JSONL record', async () => {
    const input = {
      ...record(),
      targets: [
        'D:\\Dự án\\line\n"quoted"\\雪🚀',
        'D:\\Projects\\line\r\nbreak',
      ],
    };
    await service.append(input);
    const records = await readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].targets).toEqual(input.targets);
  });

  it('propagates the original ensureDir failure and recovers for a later call', async () => {
    const error = Object.assign(new Error('logs directory denied'), {
      code: 'EACCES',
    });
    appPaths.ensureDir.mockRejectedValueOnce(error);
    await expect(service.append(record('failed'))).rejects.toBe(error);
    await service.append(record('recovered'));
    expect((await readRecords()).map(({ operationId }) => operationId)).toEqual(
      ['recovered'],
    );
    expect(appPaths.ensureDir.mock.calls).toEqual([['logs'], ['logs']]);
  });

  it('continues an already queued append after the previous call rejects', async () => {
    const error = new Error('temporary logs failure');
    appPaths.ensureDir.mockRejectedValueOnce(error);
    const first = service.append(record('failed'));
    const firstRejected = expect(first).rejects.toBe(error);
    const second = service.append(record('queued'));
    await Promise.all([firstRejected, second]);
    expect((await readRecords()).map(({ operationId }) => operationId)).toEqual(
      ['queued'],
    );
  });

  it('propagates a native directory-write error and recovers after the destination is fixed', async () => {
    await mkdir(logsDir, { recursive: true });
    appPaths.auditLogFilePath = logsDir;
    // Node reports EISDIR on POSIX; Windows may report EPERM for the same operation.
    let nativeError: NodeJS.ErrnoException | undefined;
    try {
      await appendFile(logsDir, 'probe\n', 'utf8');
    } catch (error) {
      nativeError = error as NodeJS.ErrnoException;
    }
    expect(nativeError).toBeDefined();
    expect(['EISDIR', 'EPERM']).toContain(nativeError?.code);
    await expect(service.append(record('failed'))).rejects.toMatchObject({
      code: nativeError?.code,
    });
    appPaths.auditLogFilePath = join(logsDir, 'dangerous-operations.jsonl');
    await service.append(record('recovered'));
    expect((await readRecords()).map(({ operationId }) => operationId)).toEqual(
      ['recovered'],
    );
  });

  it('preserves existing bytes when appending to a file', async () => {
    await mkdir(logsDir, { recursive: true });
    const existing = '{"previous":"entry"}\n';
    await writeFile(appPaths.auditLogFilePath, existing, 'utf8');
    await service.append(record());
    const contents = await readFile(appPaths.auditLogFilePath, 'utf8');
    expect(contents.startsWith(existing)).toBe(true);
    expect(contents.split('\n')).toHaveLength(3);
    expect(JSON.parse(contents.split('\n')[1]) as IAuditRecord).toMatchObject(
      record(),
    );
  });

  it('ensures the logs directory again on every append', async () => {
    await service.append(record('before'));
    await rm(logsDir, { recursive: true });
    await service.append(record('after'));
    expect((await readRecords()).map(({ operationId }) => operationId)).toEqual(
      ['after'],
    );
    expect(appPaths.ensureDir.mock.calls).toEqual([['logs'], ['logs']]);
  });

  it('keeps omitted optional fields absent and retains a result error code', async () => {
    const input: IAuditRecord = {
      operation: 'file-ops.delete',
      operationId: 'result-only',
      phase: 'result',
      targets: [],
      risk: { level: 'low', codes: [] },
      result: 'not_started',
      errorCode: 'AUDIT_UNAVAILABLE',
    };
    await service.append(input);
    const [saved] = await readRecords();
    expect(saved).toMatchObject(input);
    expect(saved).not.toHaveProperty('method');
    const next = record('without-optionals');
    delete next.method;
    delete next.errorCode;
    await service.append(next);
    const records = await readRecords();
    expect(records[1]).not.toHaveProperty('method');
    expect(records[1]).not.toHaveProperty('errorCode');
  });

  it('does not consult cwd or print record contents to the console', async () => {
    const cwd = jest.spyOn(process, 'cwd');
    const output = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];
    await service.append(record());
    expect(cwd).not.toHaveBeenCalled();
    for (const spy of output) expect(spy).not.toHaveBeenCalled();
    expect(await readRecords()).toHaveLength(1);
  });

  it('exports a global singleton usable by a module without a direct audit import', async () => {
    @Global()
    @Module({
      providers: [{ provide: AppPathsService, useValue: appPaths }],
      exports: [AppPathsService],
    })
    class TestPathsModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestPathsModule, AuditLogModule, AuditConsumerModule],
    }).compile();
    try {
      const consumer = moduleRef
        .select(AuditConsumerModule)
        .get(AuditConsumer, { strict: true });
      expect(consumer.audit).toBe(moduleRef.get(AuditLogService));
      await consumer.audit.append(record('via-module'));
      expect(
        (await readRecords()).map(({ operationId }) => operationId),
      ).toEqual(['via-module']);
    } finally {
      await moduleRef.close();
    }
  });
});
