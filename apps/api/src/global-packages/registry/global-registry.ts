import type {
  IGlobalRegistryInput,
  IGlobalTargetFacts,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalManager,
  IGlobalVersions,
} from '@/global-packages/interfaces/global-packages.types';
import type { GlobalReasonCode } from '@/global-packages/interfaces/global-packages.types';
import { createHash } from 'node:crypto';
import { AppException } from '@/common/exceptions/app.exception';
import { assessGlobalRegistryPolicy } from '@/global-packages/config/global-config';
import { isGlobalExactVersion } from '@/global-packages/execution/global-command';
import {
  isGlobalPackageName,
  isGlobalTargetVersion,
  normalizeGlobalBins,
} from '@/global-packages/policy/global-policy';
import { ProjectRegistry } from '@/projects/registry/project-registry';
import {
  isProjectRecord,
  jsonDepthWithinLimit,
} from '@/projects/locks/project-lock-common';

const ORIGIN = 'https://registry.npmjs.org';
const fail = (reason: GlobalReasonCode): AppException =>
  new AppException(
    reason === 'INVALID_PACKAGE_SPEC' ? 400 : 409,
    'Global registry request failed',
    reason === 'INVALID_PACKAGE_SPEC' ? 'VALIDATION_ERROR' : 'CONFLICT',
    { reason },
  );

function checkPolicy(input: IGlobalRegistryRequest, signal: AbortSignal): void {
  signal.throwIfAborted();
  if (!isGlobalPackageName(input.packageName))
    throw fail('INVALID_PACKAGE_SPEC');
  if (!assessGlobalRegistryPolicy({ ...input, action: 'change' }).changeAllowed)
    throw fail('REGISTRY_CONFIG_UNSUPPORTED');
}

function registryError(error: unknown): AppException {
  if (error instanceof AppException) return error;
  const code: unknown =
    error !== null && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  switch (code) {
    case 'PACKAGE_NOT_FOUND':
      return fail('REGISTRY_NOT_FOUND');
    case 'REGISTRY_AUTH_REQUIRED':
      return fail('REGISTRY_AUTH_REQUIRED');
    case 'REGISTRY_RATE_LIMITED':
      return fail('REGISTRY_RATE_LIMITED');
    case 'INVALID_REGISTRY_RESPONSE':
      return fail('REGISTRY_INVALID_RESPONSE');
    case 'LIMIT_EXCEEDED':
      return fail('LIMIT_EXCEEDED');
    default:
      return fail('REGISTRY_UNAVAILABLE');
  }
}

function validDist(
  value: unknown,
): value is { integrity: string; tarball: string } {
  if (
    !isProjectRecord(value) ||
    typeof value.integrity !== 'string' ||
    typeof value.tarball !== 'string'
  )
    return false;
  const match = /^(sha1|sha256|sha384|sha512)-([a-zA-Z0-9+/]+={0,2})$/.exec(
    value.integrity,
  );
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (
    bytes.length !==
      (
        { sha1: 20, sha256: 32, sha384: 48, sha512: 64 } as Record<
          string,
          number
        >
      )[match[1]] ||
    bytes.toString('base64') !== match[2]
  )
    return false;
  try {
    const url = new URL(value.tarball);
    return (
      url.protocol === 'https:' && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

export interface IGlobalRegistryRequest extends IGlobalRegistryInput {
  manager: GlobalManager;
}

export class GlobalRegistry {
  private readonly metadata: ProjectRegistry;
  private readonly slots = new Set<symbol>();
  private readonly waiters = new Set<() => void>();

  constructor(private readonly fetcher: typeof fetch = fetch) {
    this.metadata = new ProjectRegistry(fetcher);
  }

  private wakeNext(): void {
    for (const wake of this.waiters) {
      wake();
      break;
    }
  }

  private async withSlot<T>(
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    while (this.slots.size >= 4) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          this.waiters.delete(wake);
          signal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          this.waiters.delete(wake);
          signal.removeEventListener('abort', abort);
          reject(signal.reason as Error);
          if (this.slots.size < 4) this.wakeNext();
        };
        this.waiters.add(wake);
        signal.addEventListener('abort', abort, { once: true });
      });
      if (signal.aborted) {
        this.wakeNext();
        signal.throwIfAborted();
      }
    }
    const token = Symbol();
    this.slots.add(token);
    try {
      return await work();
    } catch (error) {
      signal.throwIfAborted();
      throw registryError(error);
    } finally {
      this.slots.delete(token);
      this.wakeNext();
    }
  }

  async getVersions(
    input: IGlobalRegistryRequest,
    signal: AbortSignal,
  ): Promise<IGlobalVersions> {
    checkPolicy(input, signal);
    return await this.withSlot(signal, async () => {
      // Reuse the public M5 reader, including its origin, streaming bounds and cancellation.
      const metadata = await this.metadata.getPackageMetadata(
        input.packageName,
        signal,
      );
      signal.throwIfAborted();
      const { versions, distTags } = metadata;
      if (versions.length > 10_000 || Object.keys(distTags).length > 10_000)
        throw fail('LIMIT_EXCEEDED');
      const known = new Set(versions);
      if (
        known.size !== versions.length ||
        versions.some((version) => !isGlobalExactVersion(version)) ||
        Object.entries(distTags).some(
          ([tag, version]) =>
            !isGlobalTargetVersion(tag) ||
            isGlobalExactVersion(tag) ||
            !known.has(version),
        )
      )
        throw fail('REGISTRY_INVALID_RESPONSE');
      return {
        manager: input.manager,
        package: input.packageName,
        versions,
        tags: distTags,
      };
    });
  }

  async getTarget(
    input: IGlobalRegistryRequest,
    requestedVersion: string,
    signal: AbortSignal,
  ): Promise<IGlobalTargetFacts> {
    checkPolicy(input, signal);
    if (!isGlobalTargetVersion(requestedVersion))
      throw fail('INVALID_PACKAGE_SPEC');
    let exact = requestedVersion;
    if (!isGlobalExactVersion(exact)) {
      const options = await this.getVersions(input, signal);
      signal.throwIfAborted();
      if (!Object.hasOwn(options.tags, requestedVersion))
        throw fail('REGISTRY_NOT_FOUND');
      exact = options.tags[requestedVersion];
    }
    return await this.withSlot(signal, async () => {
      const response = await this.fetcher(
        `${ORIGIN}/${encodeURIComponent(input.packageName)}/${encodeURIComponent(exact)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          credentials: 'omit',
          signal,
        },
      );
      if (signal.aborted) await response.body?.cancel().catch(() => undefined);
      signal.throwIfAborted();
      if (!response.ok || response.redirected) {
        await response.body?.cancel().catch(() => undefined);
        signal.throwIfAborted();
        throw fail(
          response.status === 404
            ? 'REGISTRY_NOT_FOUND'
            : response.status === 429
              ? 'REGISTRY_RATE_LIMITED'
              : response.status === 401 || response.status === 403
                ? 'REGISTRY_AUTH_REQUIRED'
                : 'REGISTRY_UNAVAILABLE',
        );
      }
      const bytes = await this.readExactBody(response, signal);
      signal.throwIfAborted();
      let raw: unknown;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (!jsonDepthWithinLimit(text))
          throw fail('REGISTRY_INVALID_RESPONSE');
        raw = JSON.parse(text);
      } catch {
        throw fail('REGISTRY_INVALID_RESPONSE');
      }
      if (
        !isProjectRecord(raw) ||
        raw.name !== input.packageName ||
        raw.version !== exact ||
        !validDist(raw.dist)
      )
        throw fail('REGISTRY_INVALID_RESPONSE');
      try {
        return {
          name: input.packageName,
          version: exact,
          requestedVersion,
          integrity: raw.dist.integrity,
          bins: normalizeGlobalBins(input.packageName, raw.bin),
          manifestHash: createHash('sha256').update(bytes).digest('hex'),
        };
      } catch {
        throw fail('REGISTRY_INVALID_RESPONSE');
      }
    });
  }

  private async readExactBody(
    response: Response,
    signal: AbortSignal,
  ): Promise<Buffer> {
    if (!response.body) throw fail('REGISTRY_INVALID_RESPONSE');
    const reader = response.body.getReader();
    let cancellation: Promise<void> | undefined;
    const cancel = () => {
      cancellation ??= reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    const parts: Uint8Array[] = [];
    let length = 0;
    let finished = false;
    try {
      signal.throwIfAborted();
      while (!finished) {
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) {
          finished = true;
          break;
        }
        length += next.value.byteLength;
        if (length > 4 * 1024 * 1024) throw fail('LIMIT_EXCEEDED');
        parts.push(next.value);
      }
      return Buffer.concat(parts, length);
    } finally {
      signal.removeEventListener('abort', cancel);
      if (!finished) cancel();
      await cancellation;
      reader.releaseLock();
    }
  }
}
