import { Injectable, Logger } from '@nestjs/common';
import type {
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // D8: GET poll tiến độ (mỗi giây) ghi mức debug để không ngập log.
    const isPolling =
      request.method === 'GET' &&
      this.reflector.getAllAndOverride<boolean>(POLLING_ENDPOINT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    const startTime = Date.now();

    // Lỗi do AllExceptionsFilter log đúng mức (D7), không log lại ở đây.
    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;

        const line = `${request.method} ${request.url} → ${response.statusCode} | ${duration}ms`;
        if (isPolling) {
          this.logger.debug(line);
        } else {
          this.logger.log(line);
        }
      }),
    );
  }
}
