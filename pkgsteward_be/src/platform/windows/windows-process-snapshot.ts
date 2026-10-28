import { execa } from 'execa';
import type {
  IProcessInfo,
  IProcessSnapshot,
  ProcessSnapshotResult,
} from '@/platform/interfaces/process-snapshot.interface';

export const PROCESS_SNAPSHOT_TIMEOUT_MS = 10_000;
export const PROCESS_SNAPSHOT_SCRIPT =
  "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance -ClassName Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";

export class WindowsProcessSnapshot implements IProcessSnapshot {
  async capture(): Promise<ProcessSnapshotResult> {
    let stdout: string;
    try {
      ({ stdout } = await execa(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SNAPSHOT_SCRIPT],
        { timeout: PROCESS_SNAPSHOT_TIMEOUT_MS, windowsHide: true },
      ));
    } catch (error) {
      const timedOut =
        error !== null &&
        typeof error === 'object' &&
        'timedOut' in error &&
        error.timedOut === true;
      return { status: 'unknown', reason: timedOut ? 'timeout' : 'failed' };
    }

    try {
      const parsed: unknown = stdout.trim() === '' ? [] : JSON.parse(stdout);
      const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const processes: IProcessInfo[] = [];
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
          continue;
        const raw = entry as Record<string, unknown>;
        if (
          typeof raw.ProcessId !== 'number' ||
          !Number.isInteger(raw.ProcessId) ||
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
        });
      }
      return { status: 'ok', processes };
    } catch {
      return { status: 'unknown', reason: 'bad_output' };
    }
  }
}
