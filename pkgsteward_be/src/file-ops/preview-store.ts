import {
  AppException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type { ITargetMeasurement } from '@/file-ops/file-ops-measure';
import type {
  IFileOpsPreview,
  ITargetIdentity,
} from '@/file-ops/interfaces/file-ops.types';

export const PREVIEW_TERMINAL_LIMIT = 16;

/** Server-only facts retained for execute preflight; never part of the API. */
export interface IPreviewFacts {
  identities: Map<string, ITargetIdentity>;
  measurements: Map<string, ITargetMeasurement>;
}

export interface IPreviewRecord extends IPreviewFacts {
  preview: IFileOpsPreview;
  controller: AbortController;
}

export class PreviewStore {
  private readonly records = new Map<string, IPreviewRecord>();

  create(record: IPreviewRecord): void {
    const { preview } = record;
    if (
      this.records.has(preview.previewId) ||
      (preview.status === 'running' && this.hasRunningPreview())
    ) {
      throw new AppException(
        409,
        'A preview is already running or exists',
        'CONFLICT',
      );
    }
    this.records.set(preview.previewId, {
      preview: structuredClone(preview),
      identities: structuredClone(record.identities),
      measurements: structuredClone(record.measurements),
      controller: record.controller,
    });
    this.trimTerminals();
  }

  hasRunningPreview(): boolean {
    return [...this.records.values()].some(
      ({ preview }) => preview.status === 'running',
    );
  }

  get(previewId: string): IFileOpsPreview | undefined {
    const record = this.records.get(previewId);
    return record ? structuredClone(record.preview) : undefined;
  }

  getFacts(previewId: string): IPreviewFacts | undefined {
    const record = this.records.get(previewId);
    return record
      ? structuredClone({
          identities: record.identities,
          measurements: record.measurements,
        })
      : undefined;
  }

  update(
    previewId: string,
    preview: IFileOpsPreview,
    facts?: IPreviewFacts,
  ): void {
    const record = this.records.get(previewId);
    // Ignore delayed callbacks, including those for an already evicted preview.
    if (!record || record.preview.status !== 'running') return;
    if (preview.previewId !== previewId) {
      throw new ValidationException(
        'Preview ID does not match the stored record',
      );
    }
    record.preview = structuredClone(preview);
    if (facts) {
      record.identities = structuredClone(facts.identities);
      record.measurements = structuredClone(facts.measurements);
    }
    this.trimTerminals();
  }

  abort(previewId: string): void {
    this.records.get(previewId)?.controller.abort();
  }

  attachOperation(previewId: string, operationId: string): void {
    const record = this.records.get(previewId);
    if (
      !record ||
      record.preview.status === 'running' ||
      record.preview.operationId !== null
    ) {
      throw new AppException(
        409,
        'Preview cannot take an operation',
        'CONFLICT',
      );
    }
    record.preview.operationId = operationId;
  }

  private trimTerminals(): void {
    const terminals = [...this.records.values()]
      .filter(({ preview }) => preview.status !== 'running')
      .sort(
        (a, b) =>
          Date.parse(a.preview.finishedAt ?? a.preview.startedAt) -
          Date.parse(b.preview.finishedAt ?? b.preview.startedAt),
      );
    const excess = Math.max(0, terminals.length - PREVIEW_TERMINAL_LIMIT);
    for (const record of terminals.slice(0, excess)) {
      this.records.delete(record.preview.previewId);
    }
  }
}
