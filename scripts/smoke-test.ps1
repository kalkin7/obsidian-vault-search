$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot
try {
    npm run build
    npm test
    python -X utf8 -m pytest backend/tests
} finally {
    Pop-Location
}
Write-Host "Vault Search smoke test passed."
