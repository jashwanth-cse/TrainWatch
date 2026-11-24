# scripts/verify_and_push.ps1
# TrainWatch One-Click Auto-Fix, Verification, and Push Script

param(
    [string]$Branch = "staging"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  TrainWatch: Pre-Push Auto-Fixer & Verification Runner" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Run python pre_push.py
python "$RepoRoot\scripts\pre_push.py"
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[FAIL] Pre-push verification failed. Please resolve the errors above." -ForegroundColor Red
    exit $LASTEXITCODE
}

# If any auto-fixes were generated, stage and commit them
$diff = git -C "$RepoRoot" diff --name-only
if ($diff) {
    Write-Host "`n[INFO] Auto-fixes were generated. Staging and committing..." -ForegroundColor Yellow
    git -C "$RepoRoot" add -u
    git -C "$RepoRoot" commit -m "style(auto-fix): apply automated pre-push formatting and lockfile fixes"
}

Write-Host "`n[SUCCESS] All checks passed! Pushing cleanly to $Branch..." -ForegroundColor Green
git -C "$RepoRoot" push origin $Branch
