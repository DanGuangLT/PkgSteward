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

$smoke = Join-Path $env:RUNNER_TEMP "pkgsteward-yarn-$Command-$([guid]::NewGuid())"
$scan = Join-Path $smoke 'scan'
New-Item -ItemType Directory -Path $scan -Force | Out-Null
$smokeEnvironment = @{
  MODE = if ($Command -eq 'dev') { 'development' } else { 'production' }
  HOST = '127.0.0.1'
  PORT = $null
  GLOBAL_PREFIX = 'api'
  VERSION = '1'
  EXPORT_SWAGGER_API_JSON = 'false'
  API_BASE_URL = 'http://127.0.0.1:24681/api/v1'
  PKGSTEWARD_NO_BROWSER = '1'
  PKGSTEWARD_DATA_DIR = Join-Path $smoke 'data'
  SCAN_ROOT_PATHS = $scan
}

$stdout = Join-Path $smoke 'stdout.log'
$stderr = Join-Path $smoke 'stderr.log'
$server = Start-Process node -ArgumentList ('"{0}" {1}' -f $Yarn, $Command) -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Environment $smokeEnvironment
try {
  $swaggerStatus = if ($Command -eq 'dev') { 200 } else { 404 }
  $expectedStatuses = [ordered]@{
    'http://127.0.0.1:24681/api/v1' = 200
    'http://127.0.0.1:24680/' = 200
    'http://127.0.0.1:24681/swagger' = $swaggerStatus
    'http://127.0.0.1:24681/swagger-json' = $swaggerStatus
    'http://127.0.0.1:24681/swagger-yaml' = $swaggerStatus
  }
  $pending = @($expectedStatuses.Keys)
  $lastResponses = @{}
  for ($attempt = 0; $attempt -lt 30 -and $pending.Count -gt 0; $attempt++) {
    if ($server.HasExited) { throw "yarn $Command exited with code $($server.ExitCode)" }
    $pending = @($pending | Where-Object {
      $url = $_
      try {
        $status = (Invoke-WebRequest -Uri $url -TimeoutSec 2 -SkipHttpErrorCheck).StatusCode
        $lastResponses[$url] = "HTTP $status"
        $status -ne $expectedStatuses[$url]
      } catch {
        $lastResponses[$url] = 'no HTTP response'
        $true
      }
    })
    if ($pending.Count -gt 0) { Start-Sleep -Seconds 1 }
  }
  if ($pending.Count -gt 0) {
    $expectations = $pending | ForEach-Object {
      "$_ (expected HTTP $($expectedStatuses[$_]), got $($lastResponses[$_]))"
    }
    throw "Unexpected response from: $($expectations -join ', ')"
  }
  Write-Output "Root yarn $Command returned HTTP 200 for both apps and HTTP $swaggerStatus for Swagger"
} finally {
  try {
    if (-not $server.HasExited) {
      # Handle taskkill's status here so it cannot become the workflow step's exit code.
      $termination = Start-Process -FilePath taskkill.exe -ArgumentList '/PID', $server.Id, '/T', '/F' `
        -NoNewWindow -Wait -PassThru
      if (-not $server.WaitForExit(5000)) {
        throw "Could not stop the Yarn process tree: $($server.Id) (taskkill exit $($termination.ExitCode))"
      }
      if ($termination.ExitCode -ne 0) {
        Write-Warning "taskkill returned $($termination.ExitCode) after the Yarn process exited. Checking smoke-test ports."
      }
    }
  } finally {
    Get-Content -LiteralPath $stdout, $stderr
  }
}
if (Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue) {
  throw 'A smoke-test port is still listening after shutdown'
}
