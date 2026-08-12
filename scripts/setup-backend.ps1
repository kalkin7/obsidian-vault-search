param(
    [string]$PythonExecutable = "python",
    [string]$Version = "0.1.0",
    [string]$Vault = "",
    [ValidateSet("auto", "cpu", "cuda")][string]$Runtime = "auto",
    [switch]$AcceptCudaDownload,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $RepoRoot "backend\setup-runtime.ps1"
$Profiles = [Collections.Generic.List[string]]::new()
if ($Runtime -eq "auto") { $Profiles.Add("cpu") } else { $Profiles.Add($Runtime) }
if ($Runtime -eq "auto" -and (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue)) {
    Write-Warning "NVIDIA GPU detected. CUDA PyTorch requires a multi-GB download and may take several minutes."
    $InstallCuda = $AcceptCudaDownload
    if (-not $InstallCuda -and [Environment]::UserInteractive) {
        $InstallCuda = (Read-Host "Install the CUDA runtime now? [y/N]") -match '^(?i:y|yes)$'
    }
    if ($InstallCuda) { $Profiles.Add("cuda") }
    else { Write-Warning "CUDA runtime skipped. device=auto will use CPU until CUDA is installed." }
}
$Installed = @{}
foreach ($Profile in $Profiles) {
    Write-Host "Installing $Profile runtime..."
    $Args = @{ PythonExecutable = $PythonExecutable; Version = $Version; Runtime = $Profile }
    if ($Force) { $Args.Force = $true }
    try {
        $Installed[$Profile] = (& $Installer @Args | Select-Object -Last 1)
    } catch {
        if ($Runtime -ne "auto" -or $Profile -ne "cuda") { throw }
        Write-Warning "CUDA runtime installation failed; auto will use CPU. $($_.Exception.Message)"
    }
}
$Selected = if ($Installed.ContainsKey("cuda")) { $Installed["cuda"] } else { $Installed["cpu"] }
if ($Vault) {
    $ResolvedVault = (Resolve-Path $Vault).Path
    $Canonical = [IO.Path]::GetFullPath($ResolvedVault).Replace('\', '/').ToLowerInvariant()
    $Sha = [Security.Cryptography.SHA256]::Create()
    try { $Hash = ($Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Canonical)) | ForEach-Object { $_.ToString('x2') }) -join '' }
    finally { $Sha.Dispose() }
    $MachineDir = Join-Path $env:LOCALAPPDATA ("ObsidianVaultSearch\vaults\" + $Hash.Substring(0, 20))
    New-Item -ItemType Directory -Force -Path $MachineDir | Out-Null
    $MachinePath = Join-Path $MachineDir "machine.json"
    $RuntimeMap = [ordered]@{}
    if (Test-Path $MachinePath) {
        $Existing = Get-Content -Raw -Encoding UTF8 $MachinePath | ConvertFrom-Json
        if ($Existing.PSObject.Properties.Name -contains "runtimes") {
            foreach ($Property in $Existing.runtimes.PSObject.Properties) { $RuntimeMap[$Property.Name] = $Property.Value }
        }
    }
    foreach ($Profile in $Installed.Keys) { $RuntimeMap[$Profile] = $Installed[$Profile] }
    $TempMachine = "$MachinePath.$PID.tmp"
    $Json = [ordered]@{ pythonExecutable = $Selected; runtimes = $RuntimeMap } | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($TempMachine, $Json, [Text.UTF8Encoding]::new($false))
    $Backup = "$MachinePath.$PID.backup"
    try {
        if (Test-Path $MachinePath) { [IO.File]::Replace($TempMachine, $MachinePath, $Backup) }
        else { [IO.File]::Move($TempMachine, $MachinePath) }
        if (Test-Path $Backup) { Remove-Item -Force $Backup }
    } catch {
        if (Test-Path $Backup -and -not (Test-Path $MachinePath)) { [IO.File]::Move($Backup, $MachinePath) }
        throw
    }
}
Write-Output $Selected
