import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  PATH_METADATA,
  METHOD_METADATA,
  HTTP_CODE_METADATA,
  HEADERS_METADATA,
} from '@nestjs/common/constants';
import { IS_DANGEROUS_OPERATION_KEY } from '@/common/decorators/metadata';
import { POLLING_ENDPOINT_KEY } from '@/common/decorators/throttle.decorator';
import { THROTTLER_NAMES } from '@/core/throttler-config.module';
import { PackageManagersController } from '@/package-managers/package-managers.controller';
import { PackageManagersService } from '@/package-managers/package-managers.service';
import {
  pmLifecycleFixture,
  pmUuid,
  deferred,
} from '@/package-managers/__fixtures__/pm-lifecycle.fixture';
import type { IPackageManagersService } from '@/package-managers/interfaces/package-managers.service.interface';
import { AppException } from '@/common/exceptions/app.exception';

// Expected RED: routes missing; exact contract/markers/HTTP preflight ordering.
const routes = [
  ['getProject', RequestMethod.GET, 'project', 200],
  ['versions', RequestMethod.POST, 'versions', 202],
  ['preview', RequestMethod.POST, 'project/preview', 202],
  ['execute', RequestMethod.POST, 'project/execute', 202],
  ['getLatest', RequestMethod.GET, 'jobs/latest', 200],
  ['getJob', RequestMethod.GET, 'jobs/:id', 200],
  ['cancel', RequestMethod.POST, 'jobs/:id/cancel', 200],
] as const;
describe('M9 controller HTTP contract', () => {
  it('has exactly seven routes; latest precedes the id route', () => {
    const methods = Object.getOwnPropertyNames(
      PackageManagersController.prototype,
    );
    const decorated = methods.filter((name) =>
      Reflect.hasMetadata(
        METHOD_METADATA,
        Object.getOwnPropertyDescriptor(
          PackageManagersController.prototype,
          name,
        )?.value as object,
      ),
    );
    expect(decorated).toEqual(routes.map(([name]) => name));
    expect(Reflect.getMetadata(PATH_METADATA, PackageManagersController)).toBe(
      'package-managers',
    );
    for (const [name, method, path, code] of routes) {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        PackageManagersController.prototype,
        name,
      )?.value;
      if (typeof handler !== 'function') throw new Error('TEST missing route');
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler) ?? 200).toBe(
        code,
      );
      const dangerous = name === 'execute' || name === 'cancel';
      expect(
        Reflect.getMetadata(IS_DANGEROUS_OPERATION_KEY, handler) === true,
      ).toBe(dangerous);
      const poll = name === 'getLatest' || name === 'getJob';
      expect(Reflect.getMetadata(POLLING_ENDPOINT_KEY, handler) === true).toBe(
        poll,
      );
      for (const throttle of THROTTLER_NAMES)
        expect(
          Reflect.getMetadata(`THROTTLER:SKIP${throttle}`, handler) === true,
        ).toBe(poll);
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({
        name: 'Cache-Control',
        value: 'no-store',
      });
    }
  });
  it('waits for preflight and propagates its 409 unchanged', async () => {
    const wait = deferred<void>();
    const start = {
      jobId: pmUuid(1),
      requestId: pmUuid(2),
      previewId: pmUuid(3),
      status: 'running' as const,
    };
    const service = {
      execute: jest.fn(() => Promise.resolve(start)),
      waitForPreflight: jest.fn(() => wait.promise),
      versions: jest.fn(() => Promise.resolve(start)),
      preview: jest.fn(() => Promise.resolve(start)),
      getProject: jest.fn(),
      getLatest: jest.fn(() => null),
      getJob: jest.fn(),
      cancel: jest.fn(),
    } satisfies IPackageManagersService;
    const controller = new PackageManagersController(service);
    const response = controller.execute({
      requestId: start.requestId,
      previewId: start.previewId,
      confirm: true,
    });
    await Promise.resolve();
    expect(service.waitForPreflight).toHaveBeenCalledWith(start.jobId);
    const failure = new AppException(409, 'TEST changed', 'CONFLICT', {
      reason: 'PREVIEW_CHANGED',
    });
    wait.reject(failure);
    await expect(response).rejects.toBe(failure);
    expect(controller.getLatest()).toEqual({
      statusCode: 200,
      message: 'Latest package manager job retrieved successfully',
      data: null,
    });
  });
  it('polling is a read-only snapshot with no filesystem or registry work', () => {
    const f = pmLifecycleFixture();
    const controller = new PackageManagersController(
      new PackageManagersService(f.runtime),
    );
    expect(controller.getLatest().data).toBeNull();
    expect(f.getPackageMetadata).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });
});
