import type {
  IScanJob,
  IScanResult,
  IScanStart,
} from '@/scanner/interfaces/scanner.types';

export interface IScannerService {
  hasRunningScan(): boolean;
  startScan(): IScanStart;
  getScan(scanId: string): IScanJob;
  cancelScan(scanId: string): IScanJob;
  getLatest(): IScanResult;
}
