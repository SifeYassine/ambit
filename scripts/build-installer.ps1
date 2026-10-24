# Builds the Windows NSIS installer for this local (GNU toolchain) setup.
#
# Usage, from anywhere:
#   powershell -ExecutionPolicy Bypass -File D:\ambit\scripts\build-installer.ps1
#   ... -SkipChecks   to skip lint and typecheck
#
# Compared with `pnpm run app:build`, this:
#   - calls pnpm directly (corepack is not installed here),
#   - passes the GNU target explicitly, so Tauri packages WebView2Loader.dll and the GNU mediainfo,
#   - leaves the developer tools from src-tauri/src/bin (e.g. export_bindings.exe) out of the installer,
#   - skips updater artifacts, which need the upstream project's signing key.

param(
    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = 'x86_64-pc-windows-gnu'
$releaseDir = Join-Path $repoRoot "src-tauri\target\$target\release"
$nsisDir = Join-Path $releaseDir 'nsis\x64'
$makensis = Join-Path $env:LOCALAPPDATA 'tauri\NSIS\makensis.exe'

function Invoke-Step([string]$Name, [scriptblock]$Command) {
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit code $LASTEXITCODE)" }
}

Push-Location $repoRoot
try {
    if (-not $SkipChecks) {
        Invoke-Step 'Lint' { pnpm run lint }
        Invoke-Step 'Typecheck' { pnpm run typecheck }
    }

    # Windows PowerShell mangles quotes in JSON arguments, so the config override goes through a file.
    $configPath = Join-Path $env:TEMP 'ambit-build-installer.json'
    Set-Content -Path $configPath -Encoding ASCII -Value '{"build":{"beforeBuildCommand":"pnpm run build"},"bundle":{"createUpdaterArtifacts":false}}'
    Invoke-Step 'Tauri build' { pnpm exec tauri build --ci --target $target --bundles nsis --config $configPath }

    # Tauri adds every program in src-tauri/src/bin to the installer. Swap their copy
    # lines for deletes, so they are not shipped and old copies are cleaned up on upgrade.
    $devTools = Get-ChildItem (Join-Path $repoRoot 'src-tauri\src\bin') -Filter '*.rs' | ForEach-Object { $_.BaseName + '.exe' }
    $scriptPath = Join-Path $nsisDir 'installer.nsi'
    $script = [IO.File]::ReadAllText($scriptPath)
    foreach ($tool in $devTools) {
        $copyLine = '(?m)^(\s*)File /a "/oname=' + [regex]::Escape($tool) + '" ".*"\s*$'
        $script = [regex]::Replace($script, $copyLine, { param($m) $m.Groups[1].Value + 'Delete "$INSTDIR\' + $tool + '"' })
    }
    [IO.File]::WriteAllText($scriptPath, $script, (New-Object Text.UTF8Encoding $true))

    Invoke-Step 'Repackage installer without developer tools' {
        Push-Location $nsisDir
        try { & $makensis -INPUTCHARSET UTF8 -OUTPUTCHARSET UTF8 -V2 installer.nsi } finally { Pop-Location }
    }

    $installer = Get-ChildItem (Join-Path $releaseDir 'bundle\nsis') -Filter '*-setup.exe' | Select-Object -First 1
    Copy-Item (Join-Path $nsisDir 'nsis-output.exe') $installer.FullName -Force

    $installer = Get-Item $installer.FullName
    Write-Host "`nInstaller ready: $($installer.FullName) ($([math]::Round($installer.Length / 1MB, 1)) MB)" -ForegroundColor Green
}
finally {
    Pop-Location
}
