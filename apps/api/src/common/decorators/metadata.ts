import { SetMetadata } from '@nestjs/common';

export const IS_DANGEROUS_OPERATION_KEY = 'isDangerousOperation';
export const DANGEROUS_OPERATION_DESCRIPTION_KEY =
  'dangerousOperationDescription';

/**
 * Decorator đánh dấu endpoint có thao tác nguy hiểm (xoá file/thư mục, đổi version global...).
 * Dùng cho audit log và interceptor bảo vệ theo spec mục 4.0.
 */
export const DangerousOperation = (description?: string) =>
  SetMetadata(IS_DANGEROUS_OPERATION_KEY, description ?? true);
