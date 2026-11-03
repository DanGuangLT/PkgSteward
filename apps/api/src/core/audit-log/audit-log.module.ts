import { Global, Module } from '@nestjs/common';
import { AuditLogService } from '@/core/audit-log/audit-log.service';

@Global()
@Module({ providers: [AuditLogService], exports: [AuditLogService] })
export class AuditLogModule {}
