param(
    [string]$PythonExecutable = "python",
    [string]$Version = "0.1.1",
    [ValidateSet("cpu", "cuda")][string]$Runtime,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "ObsidianVaultSearch\runtime\$Version"
$ProfileRoot = Join-Path $RuntimeRoot $Runtime
$Generation = "venv-" + [Guid]::NewGuid().ToString("N")
$Target = Join-Path $RuntimeRoot "$Runtime\$Generation"
$TargetPython = Join-Path $Target "Scripts\python.exe"
$BackendRoot = $PSScriptRoot
$LockPath = Join-Path $RuntimeRoot "$Runtime.install.lock"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Get-DepsHash([string]$Kind) {
    $Reqs = if ($Kind -eq "cuda") { "requirements-runtime.txt" } else { "requirements.txt" }
    $ReqsPath = Join-Path $BackendRoot $Reqs
    if (-not (Test-Path $ReqsPath)) { return "" }
    $Bytes = [IO.File]::ReadAllBytes($ReqsPath)
    $Sha = [Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($Sha.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant()
}

function Test-Runtime([string]$Python, [string]$Kind) {
    if (-not (Test-Path $Python)) { return $false }
    $Marker = Join-Path (Split-Path -Parent (Split-Path -Parent $Python)) ".complete.json"
    if (-not (Test-Path $Marker)) { return $false }
    try {
        $MarkerJson = Get-Content -Raw $Marker | ConvertFrom-Json
    } catch { return $false }
    if ($MarkerJson.backend_version -ne $Version) { return $false }
    if ($MarkerJson.deps_hash -ne (Get-DepsHash $Kind)) { return $false }
    if ($Kind -eq "cuda") {
        & $Python -X utf8 -c "import torch,transformers,tokenizers,sentence_transformers,kiwipiepy,usearch,numpy,onnxruntime,vault_search; assert vault_search.__version__ == '$Version'; assert torch.version.cuda; assert torch.cuda.is_available(); assert 'CUDAExecutionProvider' in onnxruntime.get_available_providers()" 2>$null
    } else {
        & $Python -X utf8 -c "import torch,transformers,tokenizers,sentence_transformers,kiwipiepy,usearch,numpy,vault_search; assert vault_search.__version__ == '$Version'" 2>$null
    }
    return $LASTEXITCODE -eq 0
}

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
$Lock = $null
try {
    $Lock = [IO.File]::Open($LockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    if (Test-Path $ProfileRoot) {
        Get-ChildItem -Path $ProfileRoot -Directory -Filter "venv-*" | Where-Object {
            -not (Test-Path (Join-Path $_.FullName ".complete.json"))
        } | Remove-Item -Recurse -Force
    }
    if (-not $Force -and (Test-Path $ProfileRoot)) {
        $Existing = Get-ChildItem -Path $ProfileRoot -Directory -Filter "venv-*" |
            Sort-Object LastWriteTimeUtc -Descending
        foreach ($Directory in $Existing) {
            $Python = Join-Path $Directory.FullName "Scripts\python.exe"
            if (Test-Runtime $Python $Runtime) { Write-Output $Python; exit 0 }
        }
    }
    & $PythonExecutable -X utf8 -m venv $Target
    if ($LASTEXITCODE -ne 0) { throw "Failed to create $Runtime runtime" }
    & $TargetPython -X utf8 -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "Failed to upgrade pip" }
    if ($Runtime -eq "cuda") {
        Write-Host "CUDA 12.8 PyTorch is a multi-GB download and may take several minutes."
        & $TargetPython -X utf8 -m pip install "torch==2.11.0" --index-url "https://download.pytorch.org/whl/cu128"
        if ($LASTEXITCODE -ne 0) { throw "Failed to install CUDA PyTorch" }
        & $TargetPython -X utf8 -m pip install -r (Join-Path $BackendRoot "requirements-runtime.txt")
    } else {
        & $TargetPython -X utf8 -m pip install -r (Join-Path $BackendRoot "requirements.txt")
    }
    if ($LASTEXITCODE -ne 0) { throw "Failed to install backend dependencies" }
    & $TargetPython -X utf8 -m pip install --no-deps --force-reinstall $BackendRoot
    if ($LASTEXITCODE -ne 0) { throw "Failed to install Vault Search backend" }
    if ($Runtime -eq "cuda") {
        & $TargetPython -X utf8 -c "import torch,transformers,tokenizers,sentence_transformers,kiwipiepy,usearch,numpy,onnxruntime,vault_search; assert vault_search.__version__ == '$Version'; assert torch.version.cuda; assert torch.cuda.is_available(); assert 'CUDAExecutionProvider' in onnxruntime.get_available_providers()"
    } else {
        & $TargetPython -X utf8 -c "import torch,transformers,tokenizers,sentence_transformers,kiwipiepy,usearch,numpy,vault_search; assert vault_search.__version__ == '$Version'"
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Runtime validation failed. For CUDA, check the NVIDIA driver."
    }
    $MarkerTemp = Join-Path $Target ".complete.$PID.tmp"
    $DepsHash = Get-DepsHash $Runtime
    [IO.File]::WriteAllText($MarkerTemp,
        ('{"runtime":"' + $Runtime + '","backend_version":"' + $Version + '","deps_hash":"' + $DepsHash + '"}'),
        [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($MarkerTemp, (Join-Path $Target ".complete.json"))

    Write-Output $TargetPython
} catch {
    if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
    throw
} finally {
    if ($Lock) { $Lock.Dispose() }
}
