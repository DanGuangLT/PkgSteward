import { execa } from 'execa';
import type {
  INodeManagerInfo,
  NodeManagerId,
} from '@/node-runtime/interfaces/node-runtime.types';
import {
  parseFnmList,
  parseNvmWindowsList,
  parseVoltaListNode,
  type IParsedManagerVersions,
} from '@/node-runtime/parsers/node-version.parser';

export const NODE_MANAGER_PROBE_RUNNER = Symbol('NODE_MANAGER_PROBE_RUNNER');

export const PROBE_TIMEOUT_MS = 5_000;

export interface IProbeExecResult {
  exitCode?: number;
  stdout?: string;
  failed?: boolean;
  timedOut?: boolean;
}

export interface IProbeExecOptions {
  shell: false;
  windowsHide: true;
  timeout: number;
  reject: false;
}

export type ProbeExecRunner = (
  file: string,
  args: readonly string[],
  options: IProbeExecOptions,
) => Promise<IProbeExecResult>;

export const defaultProbeExecRunner: ProbeExecRunner = async (
  file,
  args,
  options,
) => {
  const result = await execa(file, [...args], {
    shell: options.shell,
    windowsHide: options.windowsHide,
    timeout: options.timeout,
    reject: options.reject,
  });
  return {
    exitCode: result.exitCode,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    failed: result.failed,
    timedOut: result.timedOut,
  };
};

interface IManagerProbeSpec {
  id: NodeManagerId;
  label: string;
  file: string;
  args: readonly string[];
  parse: (stdout: string) => IParsedManagerVersions;
}

const MANAGER_PROBES: readonly IManagerProbeSpec[] = [
  {
    id: 'nvm-windows',
    label: 'nvm-windows',
    file: 'nvm',
    args: ['list'],
    parse: parseNvmWindowsList,
  },
  {
    id: 'fnm',
    label: 'fnm',
    file: 'fnm',
    args: ['list'],
    parse: parseFnmList,
  },
  {
    id: 'volta',
    label: 'Volta',
    file: 'volta',
    args: ['list', 'node'],
    parse: parseVoltaListNode,
  },
];

async function probeSingleManager(
  spec: IManagerProbeSpec,
  runner: ProbeExecRunner,
): Promise<INodeManagerInfo> {
  try {
    const result = await runner(spec.file, spec.args, {
      shell: false,
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      reject: false,
    });
    if (result.failed || result.timedOut || result.exitCode !== 0) {
      return {
        id: spec.id,
        label: spec.label,
        detected: false,
        activeVersion: null,
        installedVersions: [],
      };
    }

    const parsed = spec.parse(result.stdout ?? '');
    return {
      id: spec.id,
      label: spec.label,
      detected: true,
      activeVersion: parsed.activeVersion,
      installedVersions: parsed.installedVersions,
    };
  } catch {
    return {
      id: spec.id,
      label: spec.label,
      detected: false,
      activeVersion: null,
      installedVersions: [],
    };
  }
}

export async function probeAllNodeManagers(
  runner: ProbeExecRunner = defaultProbeExecRunner,
): Promise<INodeManagerInfo[]> {
  return Promise.all(
    MANAGER_PROBES.map((spec) => probeSingleManager(spec, runner)),
  );
}
