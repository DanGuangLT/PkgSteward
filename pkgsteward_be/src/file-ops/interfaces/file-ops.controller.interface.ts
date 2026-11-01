import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
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

export interface IFileOpsController {
  getTree(query: { path: string }): Promise<IApiResponse<IFileTreeLevel>>;
  startCleanupPreview(input: ICleanupPreviewInput): IApiResponse<IPreviewStart>;
  startDeletePreview(input: { paths: string[] }): IApiResponse<IPreviewStart>;
  getPreview(params: { previewId: string }): IApiResponse<IFileOpsPreview>;
  cancelPreview(params: { previewId: string }): IApiResponse<IFileOpsPreview>;
  summarizePreview(
    params: { previewId: string },
    input: { paths: string[] },
  ): IApiResponse<IPreviewSummary>;
  startExecute(input: IExecuteInput): Promise<IApiResponse<IOperationStart>>;
  getOperation(params: {
    operationId: string;
  }): IApiResponse<IFileOpsOperation>;
  getActiveOperation(): IApiResponse<IFileOpsOperation | null>;
  cancelOperation(params: {
    operationId: string;
  }): IApiResponse<IFileOpsOperation>;
}
