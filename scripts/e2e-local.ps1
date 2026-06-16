# E2E LOCAL (Modo B) — sobe backend + frontend apontados para um Dolibarr REAL local e roda a
# suite Playwright COMPLETA (auth/navegação/fluxos internos). Validação profunda on-demand.
#
# Pré-requisitos (ver docs/E2E_LOCAL.md):
#   1. Dolibarr local de pé (ex.: docker compose -f docker-compose.e2e.yml up -d) com schema/seed.
#   2. Uma API key de admin do Dolibarr local + (opcional) um dump SANITIZADO carregado.
#
# Config: copie .env.e2e.example -> .env.e2e e preencha DOLIBARR_URL / DOLIBARR_API_KEY,
# OU passe por parâmetro:  ./scripts/e2e-local.ps1 -DolibarrUrl "..." -DolibarrApiKey "..."
param(
  [string]$DolibarrUrl    = $env:DOLIBARR_URL,
  [string]$DolibarrApiKey = $env:DOLIBARR_API_KEY
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# Carrega .env.e2e se existir (não versionado — pode conter chave do Dolibarr local).
$envFile = Join-Path $root ".env.e2e"
if ((-not $DolibarrUrl -or -not $DolibarrApiKey) -and (Test-Path $envFile)) {
  Get-Content $envFile | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    if ($k.Trim() -eq 'DOLIBARR_URL' -and -not $DolibarrUrl) { $DolibarrUrl = $v.Trim() }
    if ($k.Trim() -eq 'DOLIBARR_API_KEY' -and -not $DolibarrApiKey) { $DolibarrApiKey = $v.Trim() }
  }
}
if (-not $DolibarrUrl)    { $DolibarrUrl = "http://localhost:8088/api/index.php" } # default: docker-compose.e2e
if (-not $DolibarrApiKey) { Write-Error "DOLIBARR_API_KEY ausente (–DolibarrApiKey, env, ou .env.e2e). Veja docs/E2E_LOCAL.md."; exit 1 }

Write-Host "E2E local: Dolibarr = $DolibarrUrl" -ForegroundColor Cyan

$procs = @()
function Stop-All { foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } } }
function Wait-Port([int]$port, [int]$timeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return $true }
    Start-Sleep -Milliseconds 1000
  }
  return $false
}

try {
  # 1) Backend (3004) apontado pro Dolibarr local
  $beEnv = "`$env:DOLIBARR_URL='$DolibarrUrl'; `$env:DOLIBARR_API_KEY='$DolibarrApiKey'; npm run dev"
  $procs += Start-Process powershell -PassThru -WorkingDirectory (Join-Path $root 'backend') -ArgumentList @('-NoProfile','-Command', $beEnv)
  if (-not (Wait-Port 3004 120)) { throw "Backend não subiu na :3004" }
  Write-Host "Backend OK (:3004)" -ForegroundColor Green

  # 2) Frontend (3003)
  $procs += Start-Process powershell -PassThru -WorkingDirectory $root -ArgumentList @('-NoProfile','-Command','npm run dev')
  if (-not (Wait-Port 3003 120)) { throw "Frontend não subiu na :3003" }
  Write-Host "Frontend OK (:3003)" -ForegroundColor Green

  # 3) Suite E2E COMPLETA (Playwright já tem reuseExistingServer). Roda contra a stack local.
  Push-Location $root
  npx playwright test --project=chromium
  $code = $LASTEXITCODE
  Pop-Location
  Write-Host "E2E exit: $code"
  exit $code
}
finally {
  Stop-All
}
