# Starts Saldo for development: the Go server in demo mode (http://localhost:8080) and the web app with hot reload
# (http://localhost:5180). Needs Go and Node on the PATH. Works in pwsh and Windows PowerShell 5.1. More: docs/local-testing.md.
#   scripts\dev.ps1          start; Ctrl+C stops both
#   scripts\dev.ps1 -Fresh   delete server\data-demo (the demo database and logs) first: the demo story starts over
#   scripts\dev.ps1 -Stop    stop what an earlier run of this script left running (closed terminal, crash)
# The state lives in server\data-demo, never in server\data (the default of a non-demo run), so -Fresh cannot touch real data.
param([switch]$Fresh, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$serverDir = Join-Path $root 'server'
$exe = Join-Path $serverDir 'bin\saldo.exe'
$vite = Join-Path $root 'web\node_modules\vite\bin\vite.js'
$demo = Join-Path $serverDir 'data-demo'
$log = Join-Path $demo 'server.log'
$errLog = Join-Path $demo 'server.err.log'
$api = 'http://localhost:8080'
$app = 'http://localhost:5180'

# Ours = this repo's server.exe and the Vite process of this repo's web folder, found by exact image path / command line.
function Get-Ours {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe -or ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($vite)) }
}

# taskkill /T also ends the children (a Vite worker, a shell in between); the exit code does not matter.
function Stop-Ours {
  foreach ($p in @(Get-Ours)) {
    $ErrorActionPreference = 'SilentlyContinue'
    taskkill /PID $p.ProcessId /T /F *> $null
    '{0} (PID {1})' -f $p.Name, $p.ProcessId
  }
}

function Wait-Url($url, $process) {
  for ($i = 0; $i -lt 120; $i++) {
    try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2 | Out-Null; return } catch { }
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }
  $tail = if (Test-Path $log) { (Get-Content $log, $errLog -Tail 15 -ErrorAction SilentlyContinue) -join "`n" }
  throw "$url did not answer (the process stopped, or 60 seconds passed). Last server output (see $log and $errLog):`n$tail"
}

if ($Stop) {
  $stopped = @(Stop-Ours)
  if ($stopped) { 'Stopped: ' + ($stopped -join ', ') } else { 'Nothing of this repo was running.' }
  exit 0
}

foreach ($t in 'go', 'node') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Write-Host "$t is not on the PATH. Install it, open a new terminal and try again." -ForegroundColor Red; exit 1 }
}

# Pre-flight: both ports must be free, so nothing is started half way.
$busy = $false
foreach ($port in 8080, 5180) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { continue }
  $busy = $true
  $name = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  $what = if (@(Get-Ours | Where-Object ProcessId -eq $c.OwningProcess)) { 'It is an earlier run of this script: run scripts\dev.ps1 -Stop and try again.' } else { 'Close that program and try again.' }
  Write-Host "Port $port is already in use by $name (PID $($c.OwningProcess)). $what" -ForegroundColor Red
}
if ($busy) { exit 1 }

$failed = $false
try {
  if ($Fresh -and (Test-Path $demo)) {
    if ((Get-Item $demo).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "$demo is a link: not deleting it." }
    Remove-Item $demo -Recurse -Force
    "Removed $demo"
  }
  New-Item -ItemType Directory -Force $demo | Out-Null
  if (-not (Test-Path $vite)) { npm.cmd --prefix (Join-Path $root 'web') ci; if ($LASTEXITCODE) { throw 'npm ci failed.' } }
  # A built exe, not "go run": go run leaves a child exe that Stop-Process on go does not end.
  go -C $serverDir build -o $exe ./cmd/saldo
  if ($LASTEXITCODE) { throw 'go build failed.' }

  $env:SALDO_DEMO = '1'
  $env:SALDO_STATE_DIR = $demo
  $server = Start-Process $exe -WorkingDirectory $serverDir -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError $errLog
  $null = $server.Handle # keeps ExitCode readable
  Wait-Url "$api/api/health" $server
  $web = Start-Process node -ArgumentList "`"$vite`"" -WorkingDirectory (Join-Path $root 'web') -NoNewWindow -PassThru
  $null = $web.Handle
  Wait-Url $app $web

  Write-Host @"

Saldo is ready (demo mode: you are Bert, no sign-in, the date is fixed at 18 Nov 2026).
  $app   the web app with hot reload: open this one
  $api   the API (docs/api.md); it serves the built app only when SALDO_WEB_DIR is set
State dir:  $demo
Server log: $log (stdout), server.err.log (stderr)
Stop:       Ctrl+C here, or scripts\dev.ps1 -Stop from another terminal
Reset:      scripts\dev.ps1 -Fresh deletes the state dir, so the demo story starts over
"@
  while (-not $server.HasExited -and -not $web.HasExited) { Start-Sleep -Seconds 1 }
  throw $(if ($server.HasExited) { "The server stopped (exit code $($server.ExitCode)), maybe by scripts\dev.ps1 -Stop. Its output: $log and $errLog." } else { "The web app stopped (exit code $($web.ExitCode)), maybe by scripts\dev.ps1 -Stop." })
} catch {
  Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
  $failed = $true
} finally {
  $null = @(Stop-Ours)
  Write-Host 'Saldo dev stopped.'
}
if ($failed) { exit 1 }
