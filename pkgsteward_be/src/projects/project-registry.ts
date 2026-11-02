import type {
  IProjectRegistry,
  IRegistryPackageMetadata,
  RegistryAdvisories,
  RegistryVersions,
} from '@/projects/interfaces/projects.runtime';
import type { ProjectAnalysisCode } from '@/projects/interfaces/projects.types';
import {
  compareProjectText,
  isLockedVersion,
  isProjectRecord,
  isRegistryPackageName,
  yieldProjectBatch,
} from '@/projects/project-lock-common';

export const PROJECT_REGISTRY = Symbol('PROJECT_REGISTRY');

const ORIGIN = 'https://registry.npmjs.org';
const MIB = 1024 * 1024;

class RegistryFailure extends Error {
  constructor(
    readonly code: ProjectAnalysisCode,
    readonly stopScheduling = false,
  ) {
    super('Registry request failed');
  }
}

interface IWaitingRequest {
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  onAbort: () => void;
}

export class ProjectRegistry implements IProjectRegistry {
  private active = 0;
  private readonly waiting: IWaitingRequest[] = [];

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async getPackageMetadata(
    name: string,
    signal: AbortSignal,
  ): Promise<IRegistryPackageMetadata> {
    signal.throwIfAborted();
    if (!isRegistryPackageName(name)) {
      throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
    }
    const value = await this.request(
      `${ORIGIN}/${encodeURIComponent(name)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
      },
      64 * MIB,
      signal,
      true,
    );
    signal.throwIfAborted();
    if (
      !isProjectRecord(value) ||
      !isProjectRecord(value.versions) ||
      !isProjectRecord(value['dist-tags'])
    ) {
      throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
    }
    const versions: string[] = [];
    const deprecated: string[] = [];
    for (const [version, entry] of Object.entries(value.versions)) {
      if (!isLockedVersion(version) || !isProjectRecord(entry)) {
        throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
      }
      versions.push(version);
      if (typeof entry.deprecated === 'string' && entry.deprecated.length > 0) {
        deprecated.push(version);
      }
      if (versions.length % 256 === 0) await yieldProjectBatch(signal);
    }
    const distTags: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    let tags = 0;
    for (const [tag, version] of Object.entries(value['dist-tags'])) {
      if (typeof version !== 'string') {
        throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
      }
      distTags[tag] = version;
      if (++tags % 256 === 0) await yieldProjectBatch(signal);
    }
    signal.throwIfAborted();
    return {
      versions: versions.sort(compareProjectText),
      distTags,
      ...(deprecated.length
        ? { deprecatedVersions: deprecated.sort(compareProjectText) }
        : {}),
    };
  }

  async getBulkAdvisories(
    versions: RegistryVersions,
    signal: AbortSignal,
  ): Promise<RegistryAdvisories> {
    signal.throwIfAborted();
    const entries = Object.entries(versions);
    if (
      entries.some(
        ([name, values]) =>
          !isRegistryPackageName(name) ||
          !Array.isArray(values) ||
          values.some((version) => !isLockedVersion(version)),
      )
    ) {
      throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
    }
    const body = JSON.stringify(versions);
    if (entries.length > 500 || Buffer.byteLength(body) > MIB) {
      throw new RegistryFailure('LIMIT_EXCEEDED');
    }
    const value = await this.request(
      `${ORIGIN}/-/npm/v1/security/advisories/bulk`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      },
      16 * MIB,
      signal,
      false,
    );
    signal.throwIfAborted();
    if (!isProjectRecord(value)) {
      throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
    }
    const result = Object.create(null) as RegistryAdvisories;
    let count = 0;
    for (const [name, advisories] of Object.entries(value)) {
      if (!isRegistryPackageName(name) || !Array.isArray(advisories)) {
        throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
      }
      result[name] = advisories;
      if (++count % 256 === 0) await yieldProjectBatch(signal);
    }
    return result;
  }

  private acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < 4) {
      this.active++;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve, reject) => {
      const entry: IWaitingRequest = {
        signal,
        resolve,
        onAbort: () => {
          const index = this.waiting.indexOf(entry);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          reject(signal.reason as Error);
        },
      };
      this.waiting.push(entry);
      signal.addEventListener('abort', entry.onAbort, { once: true });
    });
  }

  private release(): void {
    this.active--;
    const next = this.waiting.shift();
    if (!next) return;
    next.signal.removeEventListener('abort', next.onAbort);
    this.active++;
    next.resolve(() => this.release());
  }

  private async request(
    url: string,
    options: RequestInit,
    maximum: number,
    signal: AbortSignal,
    metadata: boolean,
  ): Promise<unknown> {
    const release = await this.acquire(signal);
    try {
      signal.throwIfAborted();
      const response = await this.fetcher(url, {
        ...options,
        redirect: 'error',
        credentials: 'omit',
        signal,
      });
      if (signal.aborted || !response.ok) {
        await response.body?.cancel().catch(() => undefined);
        signal.throwIfAborted();
        if (response.status === 401 || response.status === 403) {
          throw new RegistryFailure('REGISTRY_AUTH_REQUIRED', true);
        }
        if (response.status === 404 && metadata) {
          throw new RegistryFailure('PACKAGE_NOT_FOUND');
        }
        if (response.status === 429) {
          throw new RegistryFailure('REGISTRY_RATE_LIMITED', true);
        }
        throw new RegistryFailure('REGISTRY_UNAVAILABLE', true);
      }
      return await this.readBody(response, maximum, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof RegistryFailure) throw error;
      throw new RegistryFailure('REGISTRY_UNAVAILABLE', true);
    } finally {
      // Cancellation never frees a permit while its real fetch/body is pending.
      release();
    }
  }

  private async readBody(
    response: Response,
    maximum: number,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!response.body) throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let cancelling: Promise<void> | undefined;
    const cancel = () => {
      cancelling ??= reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      for (;;) {
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximum) {
          cancel();
          throw new RegistryFailure('LIMIT_EXCEEDED');
        }
        chunks.push(chunk.value);
      }
      signal.throwIfAborted();
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks, bytes),
        );
        const result: unknown = JSON.parse(text);
        return result;
      } catch {
        throw new RegistryFailure('INVALID_REGISTRY_RESPONSE');
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      await cancelling;
      reader.releaseLock();
    }
  }
}
