import { ConfigService } from '@nestjs/config';
import { win32 } from 'node:path';
import { MutationGateService } from '@/core/mutation-gate/mutation-gate.service';
import type { IProcessSnapshot } from '@/platform/interfaces/process-snapshot.interface';
import type { IWindowsRunnerProcess } from '@/platform/windows/windows-runner-process';
import { createNpmRunnerRuntime } from '@/npm-runner/npm-runner.module';
import {
  fsFixture,
  nodeFile,
  root,
} from '@/npm-runner/__fixtures__/runner-test.fixture';

// TEST only; không phải yêu cầu nghiệp vụ.
describe('createNpmRunnerRuntime native staging wiring', () => {
  const baseBindings = () => {
    const input = fsFixture();
    input.put(nodeFile, 'TEST node');
    const appInstallDir = 'C:\\PkgSteward\\apps\\api';
    input.put(
      win32.join(
        appInstallDir,
        'dist',
        'npm-runner',
        'native-session',
        'native-console-supervisor.js',
      ),
      'TEST supervisor',
    );
    input.put(
      win32.join(
        appInstallDir,
        'dist',
        'npm-runner',
        'native-session',
        'native-console-entry.js',
      ),
      'TEST entry',
    );
    input.put('C:\\Windows\\System32\\cmd.exe', 'TEST cmd');
    const processes: IWindowsRunnerProcess = {
      capture: jest.fn(),
      descendants: jest.fn(),
      stopTree: jest.fn(),
      verifyGone: jest.fn(),
    };
    const snapshot: IProcessSnapshot = {
      capture: jest.fn().mockResolvedValue({ status: 'ok', processes: [] }),
    };
    const invalidateAllAfterMutation = jest.fn();
    return {
      input,
      appInstallDir,
      processes,
      snapshot,
      invalidateAllAfterMutation,
      bindings: {
        fs: input.deps.fs,
        processes,
        scanner: {
          getLatest: jest.fn(),
          hasRunningScan: () => false,
          refreshProject: jest.fn().mockResolvedValue(undefined),
        },
        disk: {
          hasRunningMeasurement: () => false,
          clearCache: jest.fn(),
        },
        fileOps: { hasRunningPreview: () => false },
        projects: {
          hasRunningAnalysis: () => false,
          invalidateAfterMutation: jest.fn(),
          invalidateAllAfterMutation,
        },
        gate: new MutationGateService(),
        audit: { append: jest.fn().mockResolvedValue(undefined) },
        guard: {
          assertAllowed: jest.fn((p: string) =>
            Promise.resolve({
              inputPath: p,
              resolvedPath: p,
              realPath: p,
              isSymbolicLink: false,
            }),
          ),
        },
        config: { get: jest.fn(() => undefined) } as unknown as ConfigService,
        host: {
          platform: 'win32' as const,
          execPath: nodeFile,
          env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
        },
      },
    };
  };

  it('keeps runtime.native disabled until a durable journal binding is supplied', () => {
    const f = baseBindings();
    const runtime = createNpmRunnerRuntime(f.bindings);
    expect(runtime.native).toBeUndefined();
  });

  it('wires native capability, preflight and whole-analysis invalidation when durable binding is supplied', async () => {
    const f = baseBindings();
    const persist = jest.fn().mockResolvedValue(undefined);
    const runtime = createNpmRunnerRuntime({
      ...f.bindings,
      native: {
        appInstallDir: f.appInstallDir,
        snapshot: f.snapshot,
        persist,
      },
    });
    expect(runtime.native).toBeDefined();
    await expect(runtime.native!.capability()).resolves.toBe(true);
    await expect(runtime.native!.preflight('cmd')).resolves.toMatchObject({
      status: 'ok',
      value: { shell: 'cmd', shellFile: 'C:\\Windows\\System32\\cmd.exe' },
    });
    runtime.invalidation.staleAllAnalyses?.();
    expect(f.invalidateAllAfterMutation).toHaveBeenCalledTimes(1);
    await runtime.audit.writeRecoveryIntent?.('op-1', {
      active: true,
      reason: 'UNRESOLVED_NATIVE_SESSION',
      journalPath: 'D:\\TEST\\data\\native-project-terminal-session.json',
    });
    await runtime.audit.writeRecoveryResult?.(
      'op-1',
      {
        active: true,
        reason: 'UNRESOLVED_NATIVE_SESSION',
        journalPath: 'D:\\TEST\\data\\native-project-terminal-session.json',
      },
      'cleared',
      null,
    );
    expect(f.bindings.audit.append).toHaveBeenCalledTimes(2);
    void root;
  });

  it('refuses capability, preflight and session creation on non-win32 platforms', async () => {
    const f = baseBindings();
    const runtime = createNpmRunnerRuntime({
      ...f.bindings,
      host: {
        platform: 'linux',
        execPath: '/usr/bin/node',
        env: { PATH: '/usr/bin' },
      },
      native: {
        appInstallDir: f.appInstallDir,
        snapshot: f.snapshot,
        persist: jest.fn().mockResolvedValue(undefined),
      },
    });
    await expect(runtime.native!.capability()).resolves.toBe(false);
    await expect(runtime.native!.preflight('cmd')).resolves.toEqual({
      status: 'unavailable',
    });
    expect(() => runtime.native!.createSession({} as never)).toThrow(
      'Runner process adapter unavailable',
    );
  });
});
