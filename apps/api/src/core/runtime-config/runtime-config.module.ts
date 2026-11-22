import { Global, Module } from '@nestjs/common';
import { RuntimeConfigService } from '@/core/runtime-config/runtime-config.service';

@Global()
@Module({
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
