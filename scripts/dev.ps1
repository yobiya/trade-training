<#
.SYNOPSIS
    Start trade-trainer backend (FastAPI) and frontend (Vite) for development.

.DESCRIPTION
    By default, launches backend and frontend in two separate PowerShell
    windows so each can be stopped with Ctrl+C independently and their logs
    stay separated.

.PARAMETER BackendOnly
    Start only the backend.

.PARAMETER FrontendOnly
    Start only the frontend.

.PARAMETER NoNewWindow
    Do not open new windows. Start each as a background job in the current
    session (logs will be interleaved; use Receive-Job / Stop-Job).

.EXAMPLE
    .\scripts\dev.ps1
    # backend + frontend in separate windows

.EXAMPLE
    .\scripts\dev.ps1 -BackendOnly
#>
[CmdletBinding()]
param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoNewWindow
)

$ErrorActionPreference = 'Stop'

# Force UTF-8 output in this session to avoid mojibake in mixed environments.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot          = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackendDir        = Join-Path $RepoRoot 'apps\trade-trainer\backend'
$FrontendWorkspace = 'apps/trade-trainer/frontend'

$BackendCmd  = 'uv run uvicorn trade_trainer_backend.main:app --reload --port 8001'
$FrontendCmd = "npm run dev --workspace=$FrontendWorkspace"

# Prefer PowerShell 7 (pwsh) if available, otherwise fall back to Windows PowerShell.
$Shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }

function Start-InNewWindow {
    param(
        [string]$Title,
        [string]$WorkingDir,
        [string]$Command
    )
    # Child process: set UTF-8, set window title, cd into working dir, run command.
    $inner = @(
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        "`$Host.UI.RawUI.WindowTitle = '$Title'",
        "Set-Location '$WorkingDir'",
        $Command
    ) -join '; '

    $psArgs = @('-NoExit', '-NoProfile', '-Command', $inner)
    Start-Process -FilePath $Shell -ArgumentList $psArgs
}

function Start-InBackground {
    param(
        [string]$Name,
        [string]$WorkingDir,
        [string]$Command
    )
    Start-Job -Name $Name -ScriptBlock {
        param($dir, $cmd)
        Set-Location $dir
        Invoke-Expression $cmd
    } -ArgumentList $WorkingDir, $Command | Out-Null
    Write-Host "[$Name] started as background job. Use 'Receive-Job -Name $Name' / 'Stop-Job -Name $Name'." -ForegroundColor Cyan
}

$startBackend  = -not $FrontendOnly
$startFrontend = -not $BackendOnly

if ($startBackend) {
    Write-Host "Starting backend in $BackendDir" -ForegroundColor Green
    if ($NoNewWindow) {
        Start-InBackground -Name 'trainer-backend' -WorkingDir $BackendDir -Command $BackendCmd
    } else {
        Start-InNewWindow -Title 'trade-trainer backend' -WorkingDir $BackendDir -Command $BackendCmd
    }
}

if ($startFrontend) {
    Write-Host "Starting frontend ($FrontendWorkspace)" -ForegroundColor Green
    if ($NoNewWindow) {
        Start-InBackground -Name 'trainer-frontend' -WorkingDir $RepoRoot -Command $FrontendCmd
    } else {
        Start-InNewWindow -Title 'trade-trainer frontend' -WorkingDir $RepoRoot -Command $FrontendCmd
    }
}

if (-not $NoNewWindow) {
    Write-Host ''
    Write-Host 'Backend:  http://localhost:8001/health' -ForegroundColor Yellow
    Write-Host 'Frontend: http://localhost:5173'        -ForegroundColor Yellow
    Write-Host 'Press Ctrl+C in each window to stop.'
}
