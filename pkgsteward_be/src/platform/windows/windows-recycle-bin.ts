import { execa } from 'execa';
import { isFullyQualifiedPath } from '@/common/utils/path.util';
import type {
  IRecycleBin,
  RecycleResult,
} from '@/platform/interfaces/recycle-bin.interface';

// Caller input is read only from env; never interpolate it into this script.
export const RECYCLE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
  Write-Output '{"status":"unavailable","reason":"language_mode"}'
  exit 0
}
try {
  $target = $env:PKGSTEWARD_RECYCLE_TARGET
  if ([string]::IsNullOrWhiteSpace($target)) {
    Write-Output '{"status":"unavailable","reason":"no_target"}'
    exit 0
  }
  [long]$bytes = 0
  if (-not [long]::TryParse($env:PKGSTEWARD_RECYCLE_BYTES, [ref]$bytes) -or $bytes -lt 0) {
    Write-Output '{"status":"unavailable","reason":"bad_bytes"}'
    exit 0
  }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PkgStewardRecycle {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetVolumePathNameW(string fileName, StringBuilder volumePathName, uint bufferLength);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern uint GetDriveTypeW(string rootPathName);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetVolumeNameForVolumeMountPointW(string volumeMountPoint, StringBuilder volumeName, uint bufferLength);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEOPSTRUCT {
    public IntPtr hwnd;
    public uint wFunc;
    public string pFrom;
    public string pTo;
    public ushort fFlags;
    [MarshalAs(UnmanagedType.Bool)]
    public bool fAnyOperationsAborted;
    public IntPtr hNameMappings;
    public string lpszProgressTitle;
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern int SHFileOperationW(ref SHFILEOPSTRUCT op);

  // Returns { error code, 1 if aborted }; the aborted flag is read here, as verified in the spike.
  public static int[] Recycle(string target) {
    var op = new SHFILEOPSTRUCT {
      wFunc = 3,
      pFrom = target + "\0\0",
      // SILENT | NOCONFIRMATION | ALLOWUNDO | NOERRORUI | WANTNUKEWARNING
      fFlags = 0x4454
    };
    int code = SHFileOperationW(ref op);
    return new int[] { code, op.fAnyOperationsAborted ? 1 : 0 };
  }
}
'@ | Out-Null

  $volumePath = [System.Text.StringBuilder]::new(32768)
  if (-not [PkgStewardRecycle]::GetVolumePathNameW($target, $volumePath, [uint32]$volumePath.Capacity)) {
    Write-Output '{"status":"unavailable","reason":"no_volume"}'
    exit 0
  }
  $volumeRoot = $volumePath.ToString()
  # 3 = DRIVE_FIXED, checked on the volume itself (also right for volumes mounted in a folder).
  if ([PkgStewardRecycle]::GetDriveTypeW($volumeRoot) -ne 3) {
    Write-Output '{"status":"unavailable","reason":"not_fixed"}'
    exit 0
  }
  $volumeName = [System.Text.StringBuilder]::new(1024)
  if (-not [PkgStewardRecycle]::GetVolumeNameForVolumeMountPointW($volumeRoot, $volumeName, [uint32]$volumeName.Capacity)) {
    Write-Output '{"status":"unavailable","reason":"no_volume"}'
    exit 0
  }
  $guid = [regex]::Match($volumeName.ToString(), '\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}')
  if (-not $guid.Success) {
    Write-Output '{"status":"unavailable","reason":"no_volume"}'
    exit 0
  }
  $registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\' + $guid.Value
  if (Test-Path -LiteralPath $registryPath) {
    $settings = Get-ItemProperty -LiteralPath $registryPath
    if ($settings.NukeOnDelete -eq 1) {
      Write-Output '{"status":"disabled"}'
      exit 0
    }
    if ($null -ne $settings.MaxCapacity -and $bytes -gt ([decimal]$settings.MaxCapacity * 1MB)) {
      @{ status = 'too_large'; maxCapacityMb = $settings.MaxCapacity } | ConvertTo-Json -Compress
      exit 0
    }
  }
  $outcome = [PkgStewardRecycle]::Recycle($target)
  if ($outcome[0] -ne 0 -or $outcome[1] -ne 0) {
    @{ status = 'failed'; code = $outcome[0]; aborted = ($outcome[1] -ne 0) } | ConvertTo-Json -Compress
    exit 0
  }
  if (Test-Path -LiteralPath $target) {
    Write-Output '{"status":"failed","code":0,"aborted":false,"stillExists":true}'
    exit 0
  }
  Write-Output '{"status":"recycled"}'
  exit 0
} catch {
  Write-Output '{"status":"failed","code":-1,"aborted":false}'
  exit 0
}
`;

export class WindowsRecycleBin implements IRecycleBin {
  async recycle(
    targetPath: string,
    apparentBytes: number,
  ): Promise<RecycleResult> {
    // SHFileOperation expands wildcards in pFrom and resolves relative paths against the cwd.
    if (
      !isFullyQualifiedPath(targetPath, 'win32') ||
      /[*?\0]/.test(targetPath)
    ) {
      return {
        status: 'failed',
        code: 'RECYCLE_UNAVAILABLE',
        message:
          'Recycle Bin target must be an absolute path without wildcards',
      };
    }
    try {
      const { stdout } = await execa(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', RECYCLE_SCRIPT],
        {
          env: {
            PKGSTEWARD_RECYCLE_TARGET: targetPath,
            PKGSTEWARD_RECYCLE_BYTES: String(apparentBytes),
          },
          windowsHide: true,
        },
      );
      const result: unknown = JSON.parse(stdout);
      if (
        result !== null &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        'status' in result
      ) {
        switch (result.status) {
          case 'recycled':
            return { status: 'recycled' };
          case 'disabled':
            return {
              status: 'failed',
              code: 'RECYCLE_BIN_DISABLED',
              message: 'Recycle Bin is disabled on this volume',
            };
          case 'too_large':
            return {
              status: 'failed',
              code: 'RECYCLE_BIN_TOO_SMALL',
              message: 'Target exceeds the Recycle Bin capacity',
            };
          case 'unavailable':
            return {
              status: 'failed',
              code: 'RECYCLE_UNAVAILABLE',
              message: 'Recycle Bin is unavailable',
            };
        }
      }
    } catch {
      // Process errors and malformed output share a sanitized failure below.
      // Never retry or fall back to permanent deletion.
    }
    return {
      status: 'failed',
      code: 'RECYCLE_FAILED',
      message: 'Failed to move target to the Recycle Bin',
    };
  }
}
