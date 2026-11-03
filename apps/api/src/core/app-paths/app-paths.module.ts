import { Global, Module } from '@nestjs/common';
import { AppPathsService } from '@/core/app-paths/app-paths.service';

@Global()
@Module({ providers: [AppPathsService], exports: [AppPathsService] })
export class AppPathsModule {}
