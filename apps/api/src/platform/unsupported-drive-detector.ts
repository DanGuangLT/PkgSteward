import { InternalServerException } from '@/common/exceptions/app.exception';
import type { IDriveDetector } from '@/platform/interfaces/drive-detector.interface';

// D9: không phải Windows thì chỉ lỗi khi thật sự cần danh sách ổ (bắt đầu quét "*"), không lỗi lúc khởi động.
export class UnsupportedDriveDetector implements IDriveDetector {
  constructor(private readonly platform: string) {}

  listFixedDrives(): Promise<string[]> {
    return Promise.reject(
      new InternalServerException(
        `SCAN_ROOT_PATHS="*" (every fixed drive) is only supported on Windows (current platform: ${this.platform}). Set SCAN_ROOT_PATHS to absolute folders instead.`,
      ),
    );
  }
}
