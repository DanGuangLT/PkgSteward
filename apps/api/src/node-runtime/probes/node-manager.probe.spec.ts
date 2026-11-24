import {
  probeAllNodeManagers,
  type IProbeExecOptions,
  type ProbeExecRunner,
} from '@/node-runtime/probes/node-manager.probe';

describe('node-manager.probe', () => {
  it('detects nvm-windows, fnm, and volta using strictly read-only execa arguments', async () => {
    const calls: Array<{
      file: string;
      args: readonly string[];
      options: IProbeExecOptions;
    }> = [];

    const runner: ProbeExecRunner = (file, args, options) => {
      calls.push({ file, args, options });
      if (file === 'nvm') {
        return Promise.resolve({
          exitCode: 0,
          stdout:
            '  * 24.19.0 (Currently using 64-bit executable)\r\n    22.18.0\r\n',
          failed: false,
          timedOut: false,
        });
      }
      if (file === 'fnm') {
        return Promise.resolve({
          exitCode: 0,
          stdout: '* v22.18.0 default\n* v20.18.1\n',
          failed: false,
          timedOut: false,
        });
      }
      if (file === 'volta') {
        return Promise.resolve({
          exitCode: 0,
          stdout: 'runtime node@24.19.0 (default)\n',
          failed: false,
          timedOut: false,
        });
      }
      return Promise.resolve({
        exitCode: 1,
        stdout: '',
        failed: true,
        timedOut: false,
      });
    };

    const result = await probeAllNodeManagers(runner);

    expect(calls).toEqual([
      {
        file: 'nvm',
        args: ['list'],
        options: {
          shell: false,
          windowsHide: true,
          timeout: 5_000,
          reject: false,
        },
      },
      {
        file: 'fnm',
        args: ['list'],
        options: {
          shell: false,
          windowsHide: true,
          timeout: 5_000,
          reject: false,
        },
      },
      {
        file: 'volta',
        args: ['list', 'node'],
        options: {
          shell: false,
          windowsHide: true,
          timeout: 5_000,
          reject: false,
        },
      },
    ]);

    expect(result).toEqual([
      {
        id: 'nvm-windows',
        label: 'nvm-windows',
        detected: true,
        activeVersion: '24.19.0',
        installedVersions: ['24.19.0', '22.18.0'],
      },
      {
        id: 'fnm',
        label: 'fnm',
        detected: true,
        activeVersion: '22.18.0',
        installedVersions: ['22.18.0', '20.18.1'],
      },
      {
        id: 'volta',
        label: 'Volta',
        detected: true,
        activeVersion: '24.19.0',
        installedVersions: ['24.19.0'],
      },
    ]);
  });

  it('marks manager detected with empty versions when nvm reports no installations recognized', async () => {
    const runner: ProbeExecRunner = (file) => {
      if (file === 'nvm') {
        return Promise.resolve({
          exitCode: 0,
          stdout: 'No installations recognized.\r\n',
          failed: false,
          timedOut: false,
        });
      }
      return Promise.resolve({
        exitCode: undefined,
        stdout: '',
        failed: true,
        timedOut: false,
      });
    };

    const result = await probeAllNodeManagers(runner);

    expect(result[0]).toEqual({
      id: 'nvm-windows',
      label: 'nvm-windows',
      detected: true,
      activeVersion: null,
      installedVersions: [],
    });
    expect(result[1].detected).toBe(false);
    expect(result[2].detected).toBe(false);
  });

  it('degrades gracefully when probe runner rejects or times out', async () => {
    const runner: ProbeExecRunner = (file) => {
      if (file === 'nvm') {
        return Promise.reject(new Error('ENOENT'));
      }
      if (file === 'fnm') {
        return Promise.resolve({
          exitCode: undefined,
          stdout: '* v22.18.0',
          failed: true,
          timedOut: true,
        });
      }
      return Promise.resolve({
        exitCode: 1,
        stdout: 'not found',
        failed: true,
        timedOut: false,
      });
    };

    const result = await probeAllNodeManagers(runner);

    expect(result).toEqual([
      {
        id: 'nvm-windows',
        label: 'nvm-windows',
        detected: false,
        activeVersion: null,
        installedVersions: [],
      },
      {
        id: 'fnm',
        label: 'fnm',
        detected: false,
        activeVersion: null,
        installedVersions: [],
      },
      {
        id: 'volta',
        label: 'Volta',
        detected: false,
        activeVersion: null,
        installedVersions: [],
      },
    ]);
  });
});
