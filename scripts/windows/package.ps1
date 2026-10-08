[CmdletBinding()]
param([ValidateSet('Release', 'Debug')][string]$Configuration = 'Release', [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$manifests = @(Get-ChildItem (Join-Path $root 'apps\windows\GamePack.Package') -Recurse -Filter AppxManifest.xml)
$manifest = $manifests | Where-Object {
    if ($_.FullName -notmatch "[\\/]$Configuration[\\/]") { return $false }
    try {
        [xml]$xml = Get-Content -Raw $_.FullName
        $executable = $xml.Package.Applications.Application.Executable
        return $xml.Package.Identity.ProcessorArchitecture -eq $Architecture -and $executable -and (Test-Path (Join-Path $_.DirectoryName $executable))
    } catch { return $false }
} | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $manifest) { throw 'No complete compiled Windows package layout found.' }
[xml]$layout = Get-Content -Raw $manifest.FullName
$nativeExecutable = Join-Path $manifest.DirectoryName $layout.Package.Applications.Application.Executable
$embeddedBundle = Join-Path (Split-Path $nativeExecutable -Parent) 'Bundle\index.windows.bundle'
if (-not (Test-Path $embeddedBundle)) { throw 'The package is missing the embedded JavaScript bundle beside the executable.' }
if (-not (Get-ChildItem $manifest.DirectoryName -Recurse -Filter Microsoft.ReactNative.dll)) { throw 'The package is missing Microsoft.ReactNative.dll.' }
$stage = Join-Path $root "artifacts\windows\release-stage-$Architecture"
$output = Join-Path $root 'artifacts\windows\release'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Package') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "Dependencies\$Architecture") -Force | Out-Null
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item (Join-Path $manifest.DirectoryName '*') -Destination (Join-Path $stage 'Package') -Recurse -Force
$dependencies = Get-ChildItem (Join-Path $root 'artifacts\windows\packages') -Recurse -Include '*.appx', '*.msix' | Where-Object { $_.FullName -match "[\\/]Dependencies[\\/]$Architecture[\\/]" }
foreach ($dependency in $dependencies) { Copy-Item $dependency.FullName (Join-Path $stage "Dependencies\$Architecture") -Force }
Copy-Item (Join-Path $PSScriptRoot 'install.ps1') (Join-Path $stage 'install.ps1')
Copy-Item (Join-Path $root 'apps\windows\THIRD-PARTY-NOTICES.txt') $stage
@"
GamePack for Windows $Architecture — unsigned development package

Requires Windows 10 2004 or newer. No Node, Rust, or Visual Studio is needed.
Enable Settings > System > For developers > Developer Mode.
Extract this ZIP, open PowerShell in the extracted folder, and run:

  powershell.exe -ExecutionPolicy Bypass -File .\install.ps1 -Launch

The installer installs bundled Microsoft runtime dependencies when needed,
copies the app to GAMEPACK_HOME\app\windows or USERPROFILE\.gamepack\app\windows,
and registers it for your Windows account. The extracted folder can then be removed.
Managed video, SQLite, drafts and configuration use that same GamePack root.
To uninstall the application registration:
  Get-AppxPackage GamePack | Remove-AppxPackage
Your GamePack library remains in its folder.

This package is intended for development testing. A successful CI build does
not establish video playback, drawing, or visual correctness on every machine.
Windows must have a codec installed for the videos you import.
"@ | Set-Content (Join-Path $stage 'README.txt') -Encoding UTF8
$zip = Join-Path $output "GamePack-windows-$Architecture.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zip.sha256", "$hash  GamePack-windows-$Architecture.zip`n", [Text.Encoding]::ASCII)
Write-Host "Release package: $zip"
