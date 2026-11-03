import type {
  IProcessInfo,
  IProcessSnapshot,
  ProcessSnapshotResult,
} from '@/platform/interfaces/process-snapshot.interface';
import { win32 } from 'node:path';
import { execa } from 'execa';

export const PROCESS_SNAPSHOT_TIMEOUT_MS = 10_000;
export const PROCESS_SNAPSHOT_SCRIPT =
  "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance -ClassName Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine,ParentProcessId,CreationDate | ConvertTo-Json -Compress";

export function windowsSystemRoot(value: string | undefined): string | null {
  if (
    !value ||
    !/^[A-Za-z]:[\\/]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    return null;
  return win32.normalize(value);
}

const creationTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null;
  const serialized = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  const time = serialized ? Number(serialized[1]) : Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return null;
  // Preserve any sub-millisecond precision supplied by newer PowerShell JSON.
  return serialized ? date.toISOString() : value;
};

export class WindowsProcessSnapshot implements IProcessSnapshot {
  constructor(
    readonly systemRoot: string | undefined = process.env.SystemRoot,
  ) {}

  async capture(
    timeoutMs = PROCESS_SNAPSHOT_TIMEOUT_MS,
  ): Promise<ProcessSnapshotResult> {
    const root = windowsSystemRoot(this.systemRoot);
    if (!root) return { status: 'unknown', reason: 'invalid_system_root' };
    let stdout: string;
    try {
      ({ stdout } = await execa(
        win32.join(
          root,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SNAPSHOT_SCRIPT],
        {
          timeout:
            Number.isFinite(timeoutMs) && timeoutMs > 0
              ? Math.max(
                  1,
                  Math.min(Math.floor(timeoutMs), PROCESS_SNAPSHOT_TIMEOUT_MS),
                )
              : PROCESS_SNAPSHOT_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
          shell: false,
          preferLocal: false,
          stdin: 'ignore',
          encoding: 'utf8',
          all: false,
          verbose: 'none',
        },
      ));
    } catch (error) {
      const timedOut =
        error !== null &&
        typeof error === 'object' &&
        'timedOut' in error &&
        error.timedOut === true;
      return { status: 'unknown', reason: timedOut ? 'timeout' : 'failed' };
    }
    if (Buffer.byteLength(stdout) > 16 * 1024 * 1024)
      return { status: 'unknown', reason: 'overflow' };
    try {
      const parsed: unknown = stdout.trim() === '' ? [] : JSON.parse(stdout);
      const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      if (entries.length > 100_000)
        return { status: 'unknown', reason: 'overflow' };
      const processes: IProcessInfo[] = [];
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
          continue;
        const raw = entry as Record<string, unknown>;
        if (
          typeof raw.ProcessId !== 'number' ||
          !Number.isSafeInteger(raw.ProcessId) ||
          raw.ProcessId < 0
        )
          continue;
        processes.push({
          pid: raw.ProcessId,
          name: typeof raw.Name === 'string' ? raw.Name : '',
          executablePath:
            typeof raw.ExecutablePath === 'string' ? raw.ExecutablePath : null,
          commandLine:
            typeof raw.CommandLine === 'string' ? raw.CommandLine : null,
          parentPid:
            typeof raw.ParentProcessId === 'number' &&
            Number.isSafeInteger(raw.ParentProcessId) &&
            raw.ParentProcessId >= 0
              ? raw.ParentProcessId
              : null,
          creationTime: creationTime(raw.CreationDate),
        });
      }
      return { status: 'ok', processes };
    } catch {
      return { status: 'unknown', reason: 'bad_output' };
    }
  }
}
