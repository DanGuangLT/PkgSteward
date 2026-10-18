import { Global, Module } from '@nestjs/common';
import { PathGuardService } from '@/core/path-guard/path-guard.service';

@Global()
@Module({ providers: [PathGuardService], exports: [PathGuardService] })
export class PathGuardModule {}
