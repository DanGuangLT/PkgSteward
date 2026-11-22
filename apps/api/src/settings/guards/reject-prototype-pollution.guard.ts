import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ValidationException } from '@/common/exceptions/app.exception';

const FORBIDDEN_PROTOTYPE_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
const MAX_BODY_INSPECT_DEPTH = 16;

function assertNoForbiddenKeys(value: unknown, depth: number): void {
  if (
    depth > MAX_BODY_INSPECT_DEPTH ||
    value === null ||
    typeof value !== 'object'
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenKeys(item, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) {
      throw new ValidationException(
        `Forbidden prototype key "${key}" in request body`,
      );
    }
    assertNoForbiddenKeys(record[key], depth + 1);
  }
}

@Injectable()
export class RejectPrototypePollutionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    assertNoForbiddenKeys(request.body, 0);
    return true;
  }
}
