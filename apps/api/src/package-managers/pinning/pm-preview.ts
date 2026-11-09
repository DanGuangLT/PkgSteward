import { isDeepStrictEqual } from 'node:util';
import {
  AppException,
  NotFoundException,
} from '@/common/exceptions/app.exception';
import { validateConfirmation } from '@/core/risk/confirmation';
import { riskIncreased } from '@/core/risk/risk';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import { toComparable } from '@/common/utils/path.util';
import {
  assessPmPinChange,
  getPmRisk,
} from '@/package-managers/pinning/pm-policy';
import { planPinEdit } from '@/package-managers/pinning/pm-manifest';
import type { IPmPinEdit } from '@/package-managers/pinning/pm-manifest';
import { PM_LIMITATIONS } from '@/package-managers/interfaces/pm.types';
import type {
  IPmExecuteRequest,
  IPmPreview,
  IPmPreviewRequest,
  PmReasonCode,
} from '@/package-managers/interfaces/pm.types';
import type {
  IPmProjectFacts,
  IPmRuntime,
  IPmTargetProof,
} from '@/package-managers/interfaces/pm.runtime';

export const PM_PREVIEW_TTL_MS = 300_000;
const LIMIT = 16;
const BYTES = 256 * 1024;
export const refusePm = (reason: PmReasonCode, status = 409): AppException =>
  new AppException(
    status,
    'Package manager operation refused',
    status === 400
      ? 'VALIDATION_ERROR'
      : status === 503
        ? 'SERVICE_UNAVAILABLE'
        : 'CONFLICT',
    { reason },
  );
export interface IPmPreviewRecord {
  preview: IPmPreview;
  facts: IPmProjectFacts;
  proof: IPmTargetProof;
  edit: IPmPinEdit;
  readyAt: number;
}

// Stats carry methods; structuredClone is inappropriate for these private facts.
export function snapshotPmFacts(facts: IPmProjectFacts): IPmProjectFacts {
  const identities = (items: IPmProjectFacts['identities']) =>
    items.map((item) => runnerIdentity(item.path, item.stat));
  return {
    ...facts,
    context: structuredClone(facts.context),
    bytes: Buffer.from(facts.bytes),
    manifestIdentity: {
      ...runnerIdentity(facts.manifestPath, facts.manifestIdentity).stat,
      nlink: facts.manifestIdentity.nlink,
    },
    identities: identities(facts.identities),
    tools: Object.fromEntries(
      Object.entries(facts.tools).map(([key, tool]) => [
        key,
        { ...tool, identities: identities(tool.identities) },
      ]),
    ),
  };
}
const snapshot = (record: IPmPreviewRecord): IPmPreviewRecord => ({
  ...record,
  preview: structuredClone(record.preview),
  facts: snapshotPmFacts(record.facts),
  proof: { ...record.proof },
  edit: {
    ...record.edit,
    bytes: Buffer.from(record.edit.bytes),
    replacement: Buffer.from(record.edit.replacement),
    summary: { ...record.edit.summary },
  },
});

export function createPmPreview(
  id: string,
  request: IPmPreviewRequest,
  facts: IPmProjectFacts,
  proof: IPmTargetProof,
  now: Date,
): { preview: IPmPreview; edit: IPmPinEdit } {
  const context = facts.context;
  const installed = context.installed.find(
    (item) => item.manager === request.manager,
  );
  if (!installed) throw refusePm('TOOL_NOT_FOUND');
  const decision = assessPmPinChange({
    pin: context,
    manager: request.manager,
    installed,
    targetVersion: proof.targetVersion,
    lockManagers: context.lockManagers,
    workspace: context.workspace,
    devEnginesPresent: context.devEnginesPresent,
    inputReason: context.reason,
  });
  if (!decision.eligible || !decision.targetPin)
    throw refusePm(decision.reason ?? 'PREVIEW_CHANGED');
  if (proof.requestedVersion !== request.targetVersion)
    throw refusePm('PREVIEW_CHANGED');
  const edit = planPinEdit(facts.bytes, decision.targetPin);
  return {
    edit,
    preview: {
      previewId: id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PM_PREVIEW_TTL_MS).toISOString(),
      path: context.path,
      projectName: context.projectName,
      scanId: context.scanId,
      manager: request.manager,
      rawPin: context.rawPin,
      currentVersion: context.parsedPin?.version ?? null,
      requestedVersion: request.targetVersion,
      targetVersion: proof.targetVersion,
      installedRunnerVersion: installed.version!,
      method: 'manifest-pin',
      edit: { ...edit.summary },
      warnings: decision.warnings,
      limitations: [...PM_LIMITATIONS],
      risk: getPmRisk(facts.lastActivityAt, now),
      confirmText: null,
    },
  };
}

export function assertPmPreviewUnchanged(
  preview: IPmPreview,
  previous: IPmProjectFacts,
  proof: IPmTargetProof,
  actual: IPmProjectFacts,
  target: IPmTargetProof,
  now: Date,
): void {
  if (previous.context.scanId !== actual.context.scanId)
    throw refusePm('SCAN_CHANGED');
  const sameInputs =
    previous.identities.length === actual.identities.length &&
    previous.identities.every((item) => {
      const current = actual.identities.find(
        (candidate) =>
          toComparable(candidate.path, 'win32') ===
          toComparable(item.path, 'win32'),
      );
      if (!current) return false;
      // Creating our sibling temp changes directory timestamps, not its identity.
      return item.stat.isDirectory?.()
        ? current.stat.isDirectory?.() === true &&
            !current.stat.isSymbolicLink() &&
            item.stat.dev === current.stat.dev &&
            item.stat.ino === current.stat.ino
        : sameRunnerIdentity(item.stat, current.stat);
    });
  if (
    !sameInputs ||
    toComparable(previous.context.path, 'win32') !==
      toComparable(actual.context.path, 'win32') ||
    previous.inputHash !== actual.inputHash ||
    !previous.bytes.equals(actual.bytes) ||
    !sameRunnerIdentity(previous.manifestIdentity, actual.manifestIdentity) ||
    previous.manifestIdentity.nlink !== actual.manifestIdentity.nlink ||
    !isDeepStrictEqual(proof, target) ||
    riskIncreased(preview.risk, getPmRisk(actual.lastActivityAt, now))
  )
    throw refusePm('PREVIEW_CHANGED');
  // Reapply current policy, including fresh workspace/config/tool support.
  createPmPreview(
    preview.previewId,
    {
      requestId: '',
      path: preview.path,
      manager: preview.manager,
      targetVersion: preview.requestedVersion,
    },
    actual,
    target,
    now,
  );
}
export function validatePmConfirmation(
  preview: IPmPreview,
  input: IPmExecuteRequest,
): void {
  validateConfirmation(preview.risk, preview.confirmText, input);
}

export class PmPreviewStore {
  private readonly records = new Map<
    string,
    { record: IPmPreviewRecord; consumed: boolean }
  >();
  constructor(
    private readonly clock: Pick<IPmRuntime, 'now' | 'monotonicNow'>,
  ) {}
  put(
    preview: IPmPreview,
    facts: IPmProjectFacts,
    proof: IPmTargetProof,
    edit: IPmPinEdit,
  ): IPmPreview {
    if (this.records.has(preview.previewId)) throw refusePm('PREVIEW_CONSUMED');
    const now = this.clock.now();
    const record = snapshot({
      preview: {
        ...preview,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PM_PREVIEW_TTL_MS).toISOString(),
      },
      facts,
      proof,
      edit,
      readyAt: this.clock.monotonicNow(),
    });
    // Includes original/output/replacement bytes, tool/input identities and public data.
    if (Buffer.byteLength(JSON.stringify(record)) > BYTES)
      throw refusePm('LIMIT_EXCEEDED');
    this.records.set(preview.previewId, { record, consumed: false });
    while (this.records.size > LIMIT)
      this.records.delete(this.records.keys().next().value!);
    return structuredClone(record.preview);
  }
  assertFresh(id: string): void {
    const value = this.records.get(id);
    if (!value) throw new NotFoundException('Package manager preview', id);
    if (this.clock.monotonicNow() - value.record.readyAt >= PM_PREVIEW_TTL_MS)
      throw refusePm('PREVIEW_EXPIRED');
  }
  get(id: string): IPmPreviewRecord {
    const value = this.records.get(id);
    if (!value) throw new NotFoundException('Package manager preview', id);
    if (value.consumed) throw refusePm('PREVIEW_CONSUMED');
    this.assertFresh(id);
    return snapshot(value.record);
  }
  consume(id: string): IPmPreviewRecord {
    const record = this.get(id);
    this.records.get(id)!.consumed = true;
    return record;
  }
  invalidate(): void {
    // Keep consumed tombstones until normal bounded eviction, for explicit replay refusal.
    for (const [id, entry] of this.records)
      if (!entry.consumed) this.records.delete(id);
  }
}
