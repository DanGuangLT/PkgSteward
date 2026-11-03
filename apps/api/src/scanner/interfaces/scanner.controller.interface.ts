import type { IApiResponse } from '@/common/interceptors/transform.interceptor';
import type { ScanIdParamDto } from '@/scanner/dto/scan-id-param.dto';
import type {
  IScanJob,
  IScanResult,
  IScanStart,
} from '@/scanner/interfaces/scanner.types';

export interface IScannerController {
  startScan(): IApiResponse<IScanStart>;
  getScan(params: ScanIdParamDto): IApiResponse<IScanJob>;
  cancelScan(params: ScanIdParamDto): IApiResponse<IScanJob>;
  getLatest(): IApiResponse<IScanResult>;
}
