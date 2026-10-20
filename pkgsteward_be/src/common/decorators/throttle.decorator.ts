import { applyDecorators, SetMetadata } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';

export const POLLING_ENDPOINT_KEY = 'isPollingEndpoint';

/**
 * Bỏ qua MỌI throttler đã cấu hình. `@SkipThrottle()` của thư viện mặc định chỉ bỏ throttler
 * tên "default" — 3 throttler còn lại vẫn chặn.
 */
export const SkipThrottleAll = () =>
  SkipThrottle(Object.fromEntries(THROTTLER_NAMES.map((name) => [name, true])));

/** D8: endpoint poll tiến độ — không rate limit, LoggingInterceptor ghi mức debug. */
export const PollingEndpoint = () =>
  applyDecorators(SkipThrottleAll(), SetMetadata(POLLING_ENDPOINT_KEY, true));
