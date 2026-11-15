param(
  [Parameter(Mandatory)]
  [string]$Yarn,

  [Parameter(Mandatory)]
  [ValidateSet('dev', 'start')]
  [string]$Command
)

$ErrorActionPreference = 'Stop'

$ports = 24680, 24681
if (Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue) {
  throw 'A PkgSteward smoke-test port is already in use'
}

$smoke = Join-Path $env:RUNNER_TEMP "pkgsteward-yarn-$Command"
$scan = Join-Path $smoke 'scan'
New-Item -ItemType Directory -Path $scan -Force | Out-Null
$env:MODE = if ($Command -eq 'dev') { 'development' } else { 'production' }
$env:HOST = '127.0.0.1'
$env:PORT = $null
$env:API_BASE_URL = 'http://127.0.0.1:24681/api/v1'
$env:PKGSTEWARD_NO_BROWSER = '1'
$env:PKGSTEWARD_DATA_DIR = Join-Path $smoke 'data'
$env:SCAN_ROOT_PATHS = $scan

$stdout = Join-Path $smoke 'stdout.log'
$stderr = Join-Path $smoke 'stderr.log'
$server = Start-Process node -ArgumentList ('"{0}" {1}' -f $Yarn, $Command) -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr
try {
  $pending = @('http://127.0.0.1:24681/api/v1', 'http://127.0.0.1:24680/')
  if ($Command -eq 'dev') { $pending += 'http://127.0.0.1:24681/swagger' }
  for ($attempt = 0; $attempt -lt 30 -and $pending.Count -gt 0; $attempt++) {
    if ($server.HasExited) { throw "yarn $Command exited with code $($server.ExitCode)" }
    $pending = @($pending | Where-Object {
      try { (Invoke-WebRequest -Uri $_ -TimeoutSec 2).StatusCode -ne 200 }
      catch { $true }
    })
    if ($pending.Count -gt 0) { Start-Sleep -Seconds 1 }
  }
  if ($pending.Count -gt 0) { throw "No HTTP 200 from: $($pending -join ', ')" }
  Write-Output "Root yarn $Command returned HTTP 200 for each expected endpoint"
} finally {
  try {
    if (-not $server.HasExited) {
      taskkill.exe /PID $server.Id /T /F
      if ($LASTEXITCODE -ne 0 -and -not $server.HasExited) {
        throw "Could not stop the Yarn process tree: $($server.Id)"
      }
    }
  } finally {
    Get-Content -LiteralPath $stdout, $stderr
  }
}
if (Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue) {
  throw 'A smoke-test port is still listening after shutdown'
}
