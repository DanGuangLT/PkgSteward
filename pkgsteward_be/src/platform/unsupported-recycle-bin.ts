import type {
  IRecycleBin,
  RecycleResult,
} from '@/platform/interfaces/recycle-bin.interface';

export class UnsupportedRecycleBin implements IRecycleBin {
  constructor(private readonly platform: string) {}

  recycle(targetPath: string, apparentBytes: number): Promise<RecycleResult> {
    // Unsupported hosts do not inspect the target or attempt any operation.
    void targetPath;
    void apparentBytes;
    return Promise.resolve({
      status: 'failed',
      code: 'RECYCLE_UNAVAILABLE',
      message: `Recycle Bin is only supported on Windows (current platform: ${this.platform})`,
    });
  }
}
