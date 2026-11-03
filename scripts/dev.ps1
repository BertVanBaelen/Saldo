# Starts Saldo for development: the Go server in demo mode (http://localhost:8080)
# and the web app with hot reload (http://localhost:5180). Ctrl+C stops both.
# Needs Go and Node on the PATH (see docs/architecture.md).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path (Join-Path $root 'web/node_modules'))) {
  Push-Location (Join-Path $root 'web'); npm ci; Pop-Location
}

$env:SALDO_DEMO = '1'
$env:SALDO_STATE_DIR = Join-Path $root 'server/data'
$server = Start-Process -FilePath 'go' -ArgumentList 'run', './cmd/saldo' -WorkingDirectory (Join-Path $root 'server') -NoNewWindow -PassThru
try {
  Push-Location (Join-Path $root 'web')
  npm run dev
} finally {
  Pop-Location
  if (-not $server.HasExited) { Stop-Process -Id $server.Id }
}