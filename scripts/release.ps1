param(
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$SkipBuild,
    [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"

# BRAT-compatible release automation.
#
# BRAT requires every release to carry BOTH the plugin zip AND the individual
# assets (main.js, manifest.json, styles.css, versions.json). Uploading only the
# zip makes BRAT unable to update — exactly what happened in v0.1.4.
#
# Usage:
#   .\scripts\release.ps1 -Version 0.1.5 [-SkipBuild] [-SkipPublish]
#
# Steps:
#   1. Validate version consistency across manifest/package/pyproject/__init__/constants
#   2. npm run build + backend pytest
#   3. Build obsidian-vault-search-v<ver>.zip with backend/
#   4. Create annotated tag v<ver> and push it
#   5. gh release create with zip + main.js + manifest.json + styles.css + versions.json

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Tag = "v$Version"
$ZipName = "obsidian-vault-search-v$Version.zip"

# $ErrorActionPreference = "Stop" does not turn native command failures into
# terminating errors. Run every external command through this helper and fail
# the release as soon as one of them exits non-zero.
function Invoke-Checked {
    param([scriptblock]$Script, [string]$Label)
    & $Script
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Assert-JsonVersion($Path, $Field, [switch]$IsKey) {
    $json = Get-Content -Raw -Encoding UTF8 $Path | ConvertFrom-Json
    if ($IsKey) {
        $keys = @($json.PSObject.Properties.Name)
        if ($keys -notcontains $Version) {
            throw "Missing version key $Version in ${Path}: found $($keys -join ', ')"
        }
        return
    }
    $actual = $json.$Field
    if ($actual -ne $Version) {
        throw "Version mismatch in ${Path}: expected $Version, found $actual"
    }
}

function Assert-TextVersion($Path, $ExpectedPattern) {
    $content = Get-Content -Raw -Encoding UTF8 $Path
    if ($content -notmatch $ExpectedPattern) {
        throw "Version pattern not found in $Path"
    }
}

Push-Location $RepoRoot
try {
    # 1. Version consistency
    Write-Host "==> Checking version consistency ($Version)" -ForegroundColor Cyan
    Assert-JsonVersion "manifest.json" "version"
    Assert-JsonVersion "package.json" "version"
    Assert-JsonVersion "versions.json" $Version -IsKey
    Assert-TextVersion "backend/vault_search/__init__.py" ('__version__ = "' + [regex]::Escape($Version) + '"')
    Assert-TextVersion "src/constants.ts" ('BACKEND_VERSION = "' + [regex]::Escape($Version) + '"')
    Assert-TextVersion "backend/pyproject.toml" ('version = "' + [regex]::Escape($Version) + '"')
    Write-Host "    version consistent." -ForegroundColor Green

    # 2. Build + tests
    if (-not $SkipBuild) {
        Write-Host "==> Building" -ForegroundColor Cyan
        Invoke-Checked { npm run build } "npm run build"
        Write-Host "==> Backend tests" -ForegroundColor Cyan
        Invoke-Checked { python -X utf8 -m pytest backend/tests -q } "backend pytest"
    }

    # 2b. The release zip must be built from committed artifacts so the tag and
    # the published files match. Refuse to tag a dirty tree (build output such
    # as main.js is expected to be committed as its own commit).
    Write-Host "==> Checking working tree is clean" -ForegroundColor Cyan
    $dirty = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "git status failed; cannot verify the working tree."
    }
    if ($dirty.Count -gt 0) {
        Write-Host "    working tree is dirty:" -ForegroundColor Yellow
        $dirty | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
        throw "Working tree is dirty; commit build artifacts before releasing."
    }
    Write-Host "    clean." -ForegroundColor Green

    # 3. Build the release zip (backend/ + main.js + manifest.json + styles.css)
    Write-Host "==> Building $ZipName" -ForegroundColor Cyan
    $Stage = Join-Path $env:TEMP "release-$Version"
    if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $Stage "backend/vault_search") -Force | Out-Null
    Copy-Item "main.js", "manifest.json", "styles.css" $Stage
    Copy-Item "backend/pyproject.toml", "backend/requirements.txt", `
        "backend/requirements-runtime.txt", "backend/requirements-optional-tensorrt.txt", `
        "backend/setup-runtime.ps1" (Join-Path $Stage "backend")
    Get-ChildItem "backend/vault_search" -File | Copy-Item -Destination (Join-Path $Stage "backend/vault_search")
    $Zip = Join-Path $env:TEMP $ZipName
    if (Test-Path $Zip) { Remove-Item $Zip }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($Stage, $Zip)
    Write-Host "    zip: $Zip ($((Get-Item $Zip).Length) bytes)" -ForegroundColor Green

    if ($SkipPublish) {
        Write-Host "==> Publish skipped (-SkipPublish). Zip is ready at $Zip" -ForegroundColor Yellow
        exit 0
    }

    # 4. Tag + push. Published versions are immutable: never re-tag or overwrite
    # an existing remote tag/release. Fixes ship as a new version.
    gh release view $Tag --json tagName *> $null
    if ($LASTEXITCODE -eq 0) {
        throw "$Tag already exists on the remote; bump the version. Published assets are immutable."
    }
    if ($LASTEXITCODE -gt 1) {
        throw "Could not query remote release $Tag (gh exit $LASTEXITCODE); aborting."
    }
    Write-Host "==> Tagging $Tag" -ForegroundColor Cyan
    Invoke-Checked { git tag -a $Tag -m "$Tag" } "git tag"
    Invoke-Checked { git push origin $Tag } "git push tag"

    # 5. Create release with all assets (zip + individual files)
    Write-Host "==> Creating GitHub release $Tag" -ForegroundColor Cyan
    Invoke-Checked {
        gh release create $Tag $Zip "main.js" "manifest.json" "styles.css" "versions.json" `
            --title $Tag --notes "BRAT-compatible release $Tag (zip + individual assets)"
    } "gh release create"

    # 6. Verify asset completeness
    Write-Host "==> Verifying release assets" -ForegroundColor Cyan
    $assets = gh release view $Tag --json assets --jq '.assets[].name'
    foreach ($required in @($ZipName, "main.js", "manifest.json", "styles.css", "versions.json")) {
        if ($assets -notcontains $required) { throw "Missing release asset: $required" }
    }
    Write-Host "    all assets present." -ForegroundColor Green
    Write-Host "==> Release $Tag complete: https://github.com/kalkin7/obsidian-vault-search/releases/tag/$Tag" -ForegroundColor Green
} finally {
    Pop-Location
}
