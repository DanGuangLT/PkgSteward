import { Module, ClassSerializerInterceptor } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { ThrottlerGuard } from '@nestjs/throttler';
import { EnvConfigModule } from '@/core/env-config.module';
import { ThrottlerConfigModule } from '@/core/throttler-config.module';
import { AppPathsModule } from '@/core/app-paths/app-paths.module';
import { PlatformModule } from '@/platform/platform.module';
import { PathGuardModule } from '@/core/path-guard/path-guard.module';

@Module({
  imports: [
    EnvConfigModule,
    ThrottlerConfigModule,
    AppPathsModule,
    PlatformModule,
    PathGuardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
