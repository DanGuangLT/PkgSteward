import { Injectable } from '@nestjs/common';
import { appendFile } from 'fs/promises';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import type {
  IAuditLogService,
  IAuditRecord,
} from '@/core/audit-log/interfaces/audit-log.types';

@Injectable()
export class AuditLogService implements IAuditLogService {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly appPaths: AppPathsService) {}

  append(record: IAuditRecord): Promise<void> {
    const write = this.pending.then(async () => {
      const line =
        JSON.stringify({ time: new Date().toISOString(), ...record }) + '\n';
      await this.appPaths.ensureDir('logs');
      await appendFile(this.appPaths.auditLogFilePath, line, 'utf8');
    });

    // Recover only the queue tail; the caller keeps the original rejection.
    this.pending = write.catch(() => undefined);
    return write;
  }
}
