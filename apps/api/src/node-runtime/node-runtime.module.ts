import { Module } from '@nestjs/common';
import { NodeRuntimeController } from '@/node-runtime/node-runtime.controller';
import { NodeRuntimeService } from '@/node-runtime/node-runtime.service';
import {
  defaultProbeExecRunner,
  NODE_MANAGER_PROBE_RUNNER,
} from '@/node-runtime/probes/node-manager.probe';
import { ScannerModule } from '@/scanner/scanner.module';

@Module({
  imports: [ScannerModule],
  controllers: [NodeRuntimeController],
  providers: [
    NodeRuntimeService,
    { provide: NODE_MANAGER_PROBE_RUNNER, useValue: defaultProbeExecRunner },
  ],
  exports: [NodeRuntimeService],
})
export class NodeRuntimeModule {}
