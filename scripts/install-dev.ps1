param(
    [Parameter(Mandatory = $true)][string]$Vault,
    [string]$PythonExecutable = "python",
    [switch]$Enable,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Vault = (Resolve-Path $Vault).Path
if (-not (Test-Path (Join-Path $Vault ".obsidian"))) {
    throw "Not an Obsidian vault: $Vault"
}
if (-not $SkipBuild) {
    Push-Location $RepoRoot
    try { npm run build } finally { Pop-Location }
}
$Target = Join-Path $Vault ".obsidian\plugins\obsidian-vault-search"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item -Force (Join-Path $RepoRoot "main.js") $Target
Copy-Item -Force (Join-Path $RepoRoot "manifest.json") $Target
Copy-Item -Force (Join-Path $RepoRoot "versions.json") $Target
Copy-Item -Force (Join-Path $RepoRoot "styles.css") $Target
$BackendTarget = Join-Path $Target "backend"
New-Item -ItemType Directory -Force -Path $BackendTarget | Out-Null
Copy-Item -Recurse -Force (Join-Path $RepoRoot "backend\vault_search") $BackendTarget
Copy-Item -Force (Join-Path $RepoRoot "backend\requirements.txt") $BackendTarget
Copy-Item -Force (Join-Path $RepoRoot "backend\pyproject.toml") $BackendTarget
Get-ChildItem -Path $BackendTarget -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

$DataPath = Join-Path $Target "data.json"
if (Test-Path $DataPath) {
    $Data = Get-Content -Raw -Encoding UTF8 $DataPath | ConvertFrom-Json
    if ($Data.PSObject.Properties.Name -contains "pythonExecutable") {
        $Data.PSObject.Properties.Remove("pythonExecutable")
    }
} else {
    $Data = [ordered]@{
        loadPolicy = "vault-open"
        modelProfile = "multilingual-e5-base"
        modelId = "intfloat/multilingual-e5-base"
        device = "auto"
        queryPrefix = "query: "
        documentPrefix = "passage: "
        normalizeEmbeddings = $true
        includeGlobs = @("0_Slip-box/**", "1_Projects/**", "2_Area/**", "3_Resource/**", "4_Archive/**", "5_Wiki/**", "+/**")
        excludeGlobs = @(".obsidian/**", "9_System/**", "**/node_modules/**")
        chunkChars = 400
        chunkOverlap = 60
        bm25TopK = 30
        vectorTopK = 30
        finalTopK = 20
        rrfK = 60
        maxChunksPerFile = 1
        titleRrfWeight = 1.0
        prefixFallback = $true
        syncDebounceMs = 1500
        autoSync = $true
        startupReconcile = $true
    }
}
$Data | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $DataPath

$Canonical = [IO.Path]::GetFullPath($Vault).Replace('\', '/').ToLowerInvariant()
$Sha = [Security.Cryptography.SHA256]::Create()
try { $Hash = ($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Canonical)) | ForEach-Object { $_.ToString('x2') }) -join '' }
finally { $Sha.Dispose() }
$VaultId = $Hash.Substring(0, 20)
$MachineDir = Join-Path $env:LOCALAPPDATA "ObsidianVaultSearch\vaults\$VaultId"
New-Item -ItemType Directory -Force -Path $MachineDir | Out-Null
@{ pythonExecutable = $PythonExecutable } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $MachineDir "machine.json")

if ($Enable) {
    $CommunityPath = Join-Path $Vault ".obsidian\community-plugins.json"
    $Plugins = @()
    if (Test-Path $CommunityPath) {
        $Plugins = @(Get-Content -Raw -Encoding UTF8 $CommunityPath | ConvertFrom-Json)
    }
    if ($Plugins -notcontains "obsidian-vault-search") {
        $Plugins += "obsidian-vault-search"
        $Plugins | ConvertTo-Json | Set-Content -Encoding UTF8 $CommunityPath
    }
}
Write-Host "Installed to: $Target"
Write-Host "Python: $PythonExecutable"
if ($Enable) { Write-Host "Plugin enabled in community-plugins.json; reload Obsidian if it is already open." }
