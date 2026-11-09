import { instanceToPlain, plainToInstance } from 'class-transformer';
import { assessRisk } from '@/core/risk/risk';
import {
  PmContextEntity,
  PmJobEntity,
  PmPreviewEntity,
  PmVersionsEntity,
} from '@/package-managers/entities/pm.entity';
import {
  PM_JOB_KINDS,
  PM_JOB_STATUSES,
} from '@/package-managers/interfaces/pm.types';
import type {
  IPmContext,
  IPmJob,
  IPmPreview,
  IPmVersions,
} from '@/package-managers/interfaces/pm.types';

const preview: IPmPreview = {
  previewId: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-11-09T00:00:00.000Z',
  expiresAt: '2026-11-09T00:05:00.000Z',
  path: 'D:\\TEST\\m9',
  projectName: 'TEST',
  scanId: 'TEST-scan',
  manager: 'npm',
  rawPin: 'npm@11.1.0',
  currentVersion: '11.1.0',
  requestedVersion: 'latest',
  targetVersion: '11.2.0',
  installedRunnerVersion: '11.2.0',
  method: 'manifest-pin',
  edit: {
    file: 'package.json',
    field: 'packageManager',
    operation: 'replace',
    before: 'npm@11.1.0',
    after: 'npm@11.2.0',
  },
  warnings: ['PIN_DOES_NOT_SWITCH_RUNNER'],
  limitations: [
    'EXTERNAL_EDIT_RACE',
    'PARENT_JUNCTION_RACE',
    'CRASH_TEMP_RESIDUAL',
  ],
  risk: assessRisk([]),
  confirmText: null,
};
const versions: IPmVersions = {
  manager: 'npm',
  versions: [
    { version: '11.2.0', deprecated: false, supported: true, reason: null },
  ],
  tags: { latest: '11.2.0' },
  asOf: preview.createdAt,
  stale: false,
};
const context: IPmContext = {
  path: preview.path,
  projectName: 'TEST',
  scanId: 'TEST-scan',
  asOf: preview.createdAt,
  rawPin: preview.rawPin,
  rawPinTruncated: false,
  pinState: 'parsed',
  parsedPin: { manager: 'npm', version: '11.1.0', hash: null },
  pinReason: null,
  installed: [
    {
      manager: 'npm',
      version: '11.2.0',
      toolPath: 'D:\\TEST\\npm-cli.js',
      status: 'available',
      reason: null,
    },
    {
      manager: 'pnpm',
      version: null,
      toolPath: null,
      status: 'unavailable',
      reason: 'TOOL_NOT_FOUND',
    },
    {
      manager: 'yarn',
      version: null,
      toolPath: null,
      status: 'unsupported',
      reason: 'UNSUPPORTED_MANAGER',
    },
  ],
  lockManagers: ['npm'],
  workspace: { kind: 'standalone', root: null },
  devEnginesPresent: false,
  reason: null,
  warnings: ['PIN_DOES_NOT_SWITCH_RUNNER'],
};
const job: IPmJob = {
  jobId: '00000000-0000-4000-8000-000000000002',
  requestId: preview.previewId,
  previewId: preview.previewId,
  kind: 'preview',
  path: preview.path,
  manager: 'npm',
  status: 'completed',
  phase: 'done',
  startedAt: preview.createdAt,
  finishedAt: preview.createdAt,
  cancelRequested: false,
  mutationStarted: false,
  fileCommitted: false,
  mayHaveChanged: false,
  gateHeld: false,
  auditWritten: false,
  refreshRequired: false,
  cleanupRequired: false,
  failureCode: null,
  warnings: [],
  preview,
  versions: null,
};

describe('package manager response contracts', () => {
  it('has only the no-process job kinds/statuses', () => {
    expect(PM_JOB_KINDS).toEqual(['versions', 'preview', 'mutation']);
    expect(PM_JOB_STATUSES).toEqual([
      'running',
      'completed',
      'failed',
      'cancelled',
      'timed_out',
    ]);
  });
  it('serializes every declared public field, stripping private and process facts recursively', () => {
    const dirty = {
      ...job,
      pid: 123,
      exitCode: 1,
      signal: 'SIGTERM',
      firstCursor: 0,
      bytes: Buffer.from('secret'),
      preview: {
        ...preview,
        privateFacts: {},
        edit: { ...preview.edit, bytes: 'secret' },
        risk: { ...preview.risk, secret: 'x' },
      },
      versions: {
        ...versions,
        secret: true,
        versions: [{ ...versions.versions[0], private: true }],
      },
    };
    expect(instanceToPlain(plainToInstance(PmJobEntity, dirty))).toEqual({
      ...job,
      versions,
    });
    expect(instanceToPlain(plainToInstance(PmPreviewEntity, preview))).toEqual(
      preview,
    );
    expect(
      instanceToPlain(plainToInstance(PmVersionsEntity, versions)),
    ).toEqual(versions);
  });
  it('bounds exposed context to declared facts including unsupported Yarn', () => {
    const dirty = {
      ...context,
      identities: [],
      manifest: 'secret',
      installed: context.installed.map((tool) => ({
        ...tool,
        env: { SECRET: 'secret' },
      })),
      parsedPin: { ...context.parsedPin, private: true },
      workspace: { ...context.workspace, bytes: 'secret' },
    };
    expect(instanceToPlain(plainToInstance(PmContextEntity, dirty))).toEqual(
      context,
    );
  });
});
