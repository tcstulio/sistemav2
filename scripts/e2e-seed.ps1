# Seed idempotente do sandbox Dolibarr E2E (:8088) para o piloto de cotação (Fase 4).
# Cria 1 cliente + 3 produtos SE ainda não existirem (por ref). Uso:
#   pwsh scripts/e2e-seed.ps1
# Requer o sandbox no ar (docker compose -f docker-compose.e2e.yml up -d --build) com os
# módulos Product/Propal ativos (DOLI_ENABLE_MODULES).

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8088/api/index.php'
$token = (Invoke-RestMethod -Uri "$base/login?login=admin&password=e2eadmin" -TimeoutSec 20).success.token
$H = @{ DOLAPIKEY = $token; 'Content-Type' = 'application/json' }

function Exists($path, $filter) {
    try { $r = Invoke-RestMethod -Uri "$base/$path`?sqlfilters=$filter&limit=1" -Headers $H -TimeoutSec 15; return ($r | Measure-Object).Count -gt 0 }
    catch { return $false } # 404 = lista vazia
}

# --- Cliente ---
if (-not (Exists 'thirdparties' "(t.name%3Alike%3A'Cliente Piloto Cotacao')")) {
    $body = @{ name = 'Cliente Piloto Cotacao'; client = 1; country_id = 6 } | ConvertTo-Json
    $id = Invoke-RestMethod -Uri "$base/thirdparties" -Method POST -Headers $H -Body $body -TimeoutSec 15
    Write-Host "cliente criado: id=$id"
} else { Write-Host 'cliente ja existe' }

# --- Produtos ---
$produtos = @(
    @{ ref = 'PILOTO-P1'; label = 'Servico de Consultoria (hora)'; price = 250; type = 1 },
    @{ ref = 'PILOTO-P2'; label = 'Licenca de Software (anual)'; price = 1200; type = 0 },
    @{ ref = 'PILOTO-P3'; label = 'Suporte Premium (mensal)'; price = 500; type = 0 }
)
foreach ($p in $produtos) {
    if (-not (Exists 'products' "(t.ref%3Alike%3A'$($p.ref)')")) {
        $body = $p | ConvertTo-Json
        $id = Invoke-RestMethod -Uri "$base/products" -Method POST -Headers $H -Body $body -TimeoutSec 15
        Write-Host "produto $($p.ref) criado: id=$id"
    } else { Write-Host "produto $($p.ref) ja existe" }
}

Write-Host 'seed do sandbox concluido.'
