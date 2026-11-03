import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppException } from '@/common/exceptions/app.exception';

interface HttpExceptionBody {
  message?: string | string[];
  errors?: unknown;
  [key: string]: unknown;
}

// body-parser báo lỗi này trước khi vào route. Nest < 12.3 đưa thẳng lỗi gốc tới filter;
// từ 12.3 ExpressAdapter bọc nó trong HttpException 413 với cause = lỗi gốc.
const isPayloadTooLarge = (exception: unknown): boolean => {
  const error =
    exception instanceof HttpException ? exception.cause : exception;
  return (
    error instanceof Error &&
    'type' in error &&
    error.type === 'entity.too.large'
  );
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();

    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let code = 'INTERNAL_SERVER_ERROR';
    let details: unknown;

    /**
     * 1. Custom App Exception
     */
    if (exception instanceof AppException) {
      statusCode = exception.statusCode;
      message = exception.message;
      code = exception.code;
      details = exception.details;
    } else if (isPayloadTooLarge(exception)) {
      statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Request body is too large';
      code = 'PAYLOAD_TOO_LARGE';
    } else if (exception instanceof HttpException) {
      /**
       * 2. NestJS Default Exception
       */
      statusCode = exception.getStatus();

      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as HttpExceptionBody;

        message = Array.isArray(res.message)
          ? res.message.join(', ')
          : typeof res.message === 'string'
            ? res.message
            : message;

        // Preserve validation errors detail from ValidationPipe
        if (res.errors && Array.isArray(res.errors)) {
          details = res.errors;
        }
      } else {
        message = String(exceptionResponse);
      }

      // D7: route không tồn tại → NOT_FOUND, 429 → RATE_LIMITED, còn lại HTTP_EXCEPTION
      code =
        statusCode === HttpStatus.NOT_FOUND
          ? 'NOT_FOUND'
          : statusCode === HttpStatus.TOO_MANY_REQUESTS
            ? 'RATE_LIMITED'
            : 'HTTP_EXCEPTION';
    } else if (exception instanceof Error) {
      /**
       * 3. Unknown Error
       */
      message = exception.message;
    }

    // originalUrl giữ cả tiền tố route (404 của route lạ bị Express cắt mất tiền tố trong request.url).
    const path = request.originalUrl ?? request.url;

    /**
     * Logging (D7): 4xx → warn, không stack; 5xx → error, kèm stack
     */
    const logPayload = {
      method: request.method,
      path,
      statusCode,
      message: exception instanceof Error ? message : exception,
      code,
    };
    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({
        ...logPayload,
        stack: exception instanceof Error ? exception.stack : null,
      });
    } else {
      this.logger.warn(logPayload);
    }

    /**
     * Standard Response
     */
    response.status(statusCode).json({
      statusCode,
      message:
        statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Internal server error'
          : message,
      code,
      timestamp: new Date().toISOString(),
      path,
      ...(statusCode < HttpStatus.INTERNAL_SERVER_ERROR &&
        details !== undefined && { details }),
    });
  }
}
