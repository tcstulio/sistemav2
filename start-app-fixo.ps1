# Sobe o webapp (frontend 3003 + backend 3004) e o tunel NOMEADO com endereco fixo:
#   https://app.coolgroove.com.br  ->  carnaval-tunnel  ->  http://127.0.0.1:3003
# O CNAME no Cloudflare ja e permanente; isto so liga os processos locais.
# Uso:  powershell -ExecutionPolicy Bypass -File .\start-app-fixo.ps1

Write-Host "1/2  Subindo webapp (npm run dev:all)..." -ForegroundColor Cyan
Start-Process -FilePath "npm" -ArgumentList "run","dev:all" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized

Write-Host "2/2  Subindo tunel nomeado (carnaval-tunnel -> app.coolgroove.com.br)..." -ForegroundColor Cyan
$cfg = Join-Path $env:USERPROFILE ".cloudflared\coolgroove-app-tunnel.yml"
Start-Process -FilePath "cloudflared" -ArgumentList "tunnel","--config",$cfg,"run","carnaval-tunnel" -WindowStyle Minimized

Write-Host "Pronto. Em ~10s: https://app.coolgroove.com.br" -ForegroundColor Green
