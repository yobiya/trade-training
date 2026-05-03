<#
.SYNOPSIS
    trade-trainer をリリース(本番ビルド)モードで起動する。

.DESCRIPTION
    frontend をビルドしてから vite preview(port 4173)と
    backend(port 8002)を起動する。
    開発サーバー(dev.ps1: 5173/8001)と同時起動してもポートが衝突しない。

.PARAMETER BackendOnly
    backend のみ起動(フロントエンドビルドをスキップ)。

.PARAMETER FrontendOnly
    frontend ビルド + preview のみ起動。

.PARAMETER NoBuild
    frontend のビルドをスキップして既存の dist/ を使う。

.PARAMETER NoNewWindow
    別ウィンドウを開かず、バックグラウンドジョブとして起動する。

.EXAMPLE
    .\scripts\release.ps1
    # build -> backend(8002) + preview(4173) を別ウィンドウで起動

.EXAMPLE
    .\scripts\release.ps1 -NoBuild
    # ビルド済み dist/ を使って起動
#>
[CmdletBinding()]
param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoBuild,
    [switch]$NoNewWindow
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot          = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendDir        = Join-Path $RepoRoot 'apps\trade-trainer\backend'
$FrontendWorkspace = 'apps/trade-trainer/frontend'

# ポート定義: dev(dev.ps1)=5173/8001 と衝突しない番号
$BackendPort  = 8002
$FrontendPort = 4173

# vite preview / backend proxy が参照するポートを環境変数で渡す
$env:TRAINER_PORT         = "$BackendPort"
$env:PLAYWRIGHT_BASE_URL  = "http://localhost:$FrontendPort"

$BackendCmd  = "uv run uvicorn trade_trainer_backend.main:app --port $BackendPort"
$PreviewCmd  = "npm run preview --workspace=$FrontendWorkspace"

$Shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }

function Start-InNewWindow {
    param([string]$Title, [string]$WorkingDir, [string]$Command)
    $inner = @(
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        "`$Host.UI.RawUI.WindowTitle = '$Title'",
        "Set-Location '$WorkingDir'",
        $Command
    ) -join '; '
    Start-Process -FilePath $Shell -ArgumentList @('-NoExit', '-NoProfile', '-Command', $inner)
}

function Start-InBackground {
    param([string]$Name, [string]$WorkingDir, [string]$Command)
    Start-Job -Name $Name -ScriptBlock {
        param($dir, $cmd)
        Set-Location $dir
        Invoke-Expression $cmd
    } -ArgumentList $WorkingDir, $Command | Out-Null
    Write-Host "[$Name] started as background job." -ForegroundColor Cyan
}

# --- frontend build ---
$startBackend  = -not $FrontendOnly
$startFrontend = -not $BackendOnly

if ($startFrontend -and -not $NoBuild) {
    Write-Host 'Building frontend...' -ForegroundColor Cyan
    Push-Location $RepoRoot
    try {
        # TRAINER_PORT を build 時にも渡す(vite.config.ts の proxyTarget に反映)
        npm run build "--workspace=$FrontendWorkspace"
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit $LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    Write-Host 'Build complete.' -ForegroundColor Green
}

# --- backend ---
if ($startBackend) {
    Write-Host "Starting backend on port $BackendPort" -ForegroundColor Green
    if ($NoNewWindow) {
        Start-InBackground -Name 'trainer-release-backend' -WorkingDir $BackendDir -Command $BackendCmd
    } else {
        Start-InNewWindow -Title "trade-trainer backend (release :$BackendPort)" -WorkingDir $BackendDir -Command $BackendCmd
    }
}

# --- frontend preview ---
if ($startFrontend) {
    Write-Host "Starting frontend preview on port $FrontendPort" -ForegroundColor Green
    if ($NoNewWindow) {
        Start-InBackground -Name 'trainer-release-frontend' -WorkingDir $RepoRoot -Command $PreviewCmd
    } else {
        Start-InNewWindow -Title "trade-trainer frontend (release :$FrontendPort)" -WorkingDir $RepoRoot -Command $PreviewCmd
    }
}

if (-not $NoNewWindow) {
    Write-Host ''
    Write-Host "Backend:  http://localhost:$BackendPort/health" -ForegroundColor Yellow
    Write-Host "Frontend: http://localhost:$FrontendPort"      -ForegroundColor Yellow
    Write-Host "e2e:      PLAYWRIGHT_BASE_URL=http://localhost:$FrontendPort npm run test:e2e" -ForegroundColor DarkGray
    Write-Host 'Press Ctrl+C in each window to stop.'
}
