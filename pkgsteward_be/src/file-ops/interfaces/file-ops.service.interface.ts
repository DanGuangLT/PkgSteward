import type {
  ICleanupPreviewInput,
  IExecuteInput,
  IFileOpsOperation,
  IFileOpsPreview,
  IFileTreeLevel,
  IOperationStart,
  IPreviewStart,
  IPreviewSummary,
} from '@/file-ops/interfaces/file-ops.types';

export interface IFileOpsService {
  getTree(path: string): Promise<IFileTreeLevel>;
  startCleanupPreview(input: ICleanupPreviewInput): IPreviewStart;
  startDeletePreview(input: { paths: string[] }): IPreviewStart;
  getPreview(previewId: string): IFileOpsPreview;
  cancelPreview(previewId: string): IFileOpsPreview;
  summarizePreview(previewId: string, paths: string[]): IPreviewSummary;
  startExecute(input: IExecuteInput): Promise<IOperationStart>;
  getOperation(operationId: string): IFileOpsOperation;
  cancelOperation(operationId: string): IFileOpsOperation;
}
