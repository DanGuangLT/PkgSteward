import { Global, Module } from '@nestjs/common';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';

@Global()
@Module({ providers: [MutationGateService], exports: [MutationGateService] })
export class MutationGateModule {}
