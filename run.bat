@echo off
cd /d "%~dp0"
echo ==========================================
echo      INICIANDO SISTEMA COOLGROOVE
echo ==========================================
echo.

:: 1. Verificando Docker (Removido - Modo Local Ativo)
echo 1. Modo Local (Sem Docker)
echo.
echo Limpando processos antigos do Chrome...
powershell -ExecutionPolicy Bypass -File "backend/src/scripts/clean-ghosts.ps1"
echo.

:: 1.5. Limpando portas ocupadas
echo 1.5. Limpando portas 3003 e 3004...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3003') do (
    echo Matando processo na porta 3003 (PID: %%a)
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3004') do (
    echo Matando processo na porta 3004 (PID: %%a)
    taskkill /F /PID %%a 2>nul
)
echo.

:: 2. Verificando NPM
echo 2. Verificando NPM...
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] NPM nao encontrado. Instale o Node.js.
    pause
    exit /b
)

echo 3. Iniciando Backend, Frontend e Cloudflare Tunnel...
echo     - Backend (Inclui WhatsApp): http://localhost:3004
echo     - Frontend: http://localhost:3003
echo     - Public URL: https://app.coolgroove.com.br
echo.
echo Pressione CTRL+C para parar todos os servicos.
echo.

:: Inicia o Cloudflare Tunnel em uma janela separada
start "Cloudflare Tunnel" cloudflared tunnel --config cloudflared.config.yaml run

:: Executa Backend e Frontend no terminal principal
call npm run dev:all

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [AVISO] Ocorreu um erro na execucao.
)
pause
