param(
    [string]$PythonExecutable = "python",
    [string]$Version = "0.1.0",
    [string]$Vault = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "ObsidianVaultSearch\runtime\$Version"
$Venv = Join-Path $RuntimeRoot "venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"

if ($Force -and (Test-Path $Venv)) {
    Remove-Item -Recurse -Force $Venv
}
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
if (-not (Test-Path $VenvPython)) {
    Write-Host "[1/3] Creating isolated Python environment: $Venv"
    & $PythonExecutable -X utf8 -m venv $Venv
}
Write-Host "[2/3] Installing pinned backend dependencies..."
& $VenvPython -X utf8 -m pip install --upgrade pip
& $VenvPython -X utf8 -m pip install -r (Join-Path $RepoRoot "backend\requirements.txt")
& $VenvPython -X utf8 -m pip install --no-deps --force-reinstall (Join-Path $RepoRoot "backend")
Write-Host "[3/3] Import smoke test..."
& $VenvPython -X utf8 -c "import torch, transformers, tokenizers, sentence_transformers, kiwipiepy, usearch, numpy, vault_search; print('backend environment OK')"
if ($Vault) {
    $ResolvedVault = (Resolve-Path $Vault).Path
    $Canonical = [IO.Path]::GetFullPath($ResolvedVault).Replace('\', '/').ToLowerInvariant()
    $Sha = [Security.Cryptography.SHA256]::Create()
    try { $Hash = ($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Canonical)) | ForEach-Object { $_.ToString('x2') }) -join '' }
    finally { $Sha.Dispose() }
    $MachineDir = Join-Path $env:LOCALAPPDATA ("ObsidianVaultSearch\vaults\" + $Hash.Substring(0, 20))
    New-Item -ItemType Directory -Force -Path $MachineDir | Out-Null
    @{ pythonExecutable = $VenvPython } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $MachineDir "machine.json")
}
Write-Output $VenvPython
