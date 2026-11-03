import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// D6: chặn DNS rebinding — API không auth nên chỉ nhận Host loopback đúng cổng đang lắng nghe.
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isAllowedHost = (
  host: string | undefined,
  port: number | undefined,
): boolean => {
  if (!host || port === undefined) return false;
  const value = host.trim().toLowerCase();
  return LOOPBACK_HOSTNAMES.some((name) => value === `${name}:${port}`);
};

const normalizeOrigin = (origin: string) =>
  origin.trim().replace(/\/+$/, '').toLowerCase();

export const isAllowedOrigin = (
  origin: string,
  allowedOrigins: readonly string[],
): boolean => {
  const value = normalizeOrigin(origin);
  return (
    value !== '' &&
    allowedOrigins.some((allowed) => normalizeOrigin(allowed) === value)
  );
};

export const isWriteMethod = (method: string): boolean =>
  WRITE_METHODS.has(method.toUpperCase());

export const parseAllowedOrigins = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

export interface IHostOriginGuardOptions {
  allowedOrigins: readonly string[];
}

// Middleware Express chạy ngoài pipeline Nest → tự trả body lỗi chuẩn (AllExceptionsFilter không bắt).
export const createHostOriginMiddleware = ({
  allowedOrigins,
}: IHostOriginGuardOptions) => {
  const logger = new Logger('HostOriginGuard');
  const reject = (req: Request, res: Response, message: string) => {
    logger.warn(
      `${req.method} ${req.originalUrl} → 403 ${message} (host=${req.headers.host ?? '-'}, origin=${req.headers.origin ?? '-'})`,
    );
    res.status(403).json({
      statusCode: 403,
      message,
      code: 'FORBIDDEN',
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    // Cổng thật của socket nhận request: chạy thật = PORT, supertest = cổng ngẫu nhiên.
    if (!isAllowedHost(req.headers.host, req.socket.localPort)) {
      return reject(req, res, 'Host not allowed');
    }
    const origin = req.headers.origin;
    if (
      isWriteMethod(req.method) &&
      origin !== undefined &&
      !isAllowedOrigin(origin, allowedOrigins)
    ) {
      return reject(req, res, 'Origin not allowed');
    }
    next();
  };
};
