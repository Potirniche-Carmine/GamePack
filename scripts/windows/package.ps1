[CmdletBinding()]
param([ValidateSet('Release', 'Debug')][string]$Configuration = 'Release', [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'package-validation.ps1')
function Read-PackageIdentity([string]$Path) {
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entry = $archive.GetEntry('AppxManifest.xml')
        if (-not $entry) { throw "Dependency has no AppxManifest.xml: $Path" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$document = $reader.ReadToEnd() } finally { $reader.Dispose() }
        return $document.Package.Identity
    } finally { $archive.Dispose() }
}
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
$nativeRuntime = @(Get-ChildItem $manifest.DirectoryName -Recurse -Filter Microsoft.ReactNative.dll)
if (-not $nativeRuntime.Count) { throw 'The package is missing Microsoft.ReactNative.dll.' }
Assert-PeArchitecture $nativeExecutable $Architecture
foreach ($runtime in $nativeRuntime) { Assert-PeArchitecture $runtime.FullName $Architecture }
$stage = Join-Path $root "artifacts\windows\release-stage-$Architecture"
$output = Join-Path $root 'artifacts\windows\release'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Package') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "Dependencies\$Architecture") -Force | Out-Null
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item (Join-Path $manifest.DirectoryName '*') -Destination (Join-Path $stage 'Package') -Recurse -Force
$dependencies = Get-ChildItem (Join-Path $root 'artifacts\windows\packages') -Recurse -Include '*.appx', '*.msix' | Where-Object { $_.FullName -match "[\\/]Dependencies[\\/]($Architecture|neutral)[\\/]" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$identities = @($dependencies | ForEach-Object { Read-PackageIdentity $_.FullName })
foreach ($required in @($layout.Package.Dependencies.PackageDependency)) {
    if (-not $required -or -not $required.Name) { continue }
    $minimumVersion = if ($required.MinVersion) { [version]$required.MinVersion } else { [version]'0.0.0.0' }
    # A declared framework identity is required even if some of its DLLs are sidecars.
    $matching = @($identities | Where-Object {
        $_.Name -eq $required.Name -and [version]$_.Version -ge $minimumVersion -and
        ($_.ProcessorArchitecture -eq $Architecture -or $_.ProcessorArchitecture -eq 'neutral') -and
        (-not $required.Publisher -or $_.Publisher -eq $required.Publisher)
    })
    if (-not $matching.Count) { throw "Package declares missing $Architecture runtime framework: $($required.Name) >= $($required.MinVersion)" }
}
foreach ($dependency in $dependencies) { Copy-Item $dependency.FullName (Join-Path $stage "Dependencies\$Architecture") -Force }
$noticeTarget = if ($Architecture -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
& node (Join-Path $root 'scripts\collect-notices.mjs') (Join-Path $stage 'Package\Notices') --target $noticeTarget
if ($LASTEXITCODE -ne 0) { throw 'Could not collect dependency notices for the release package.' }
Copy-Item (Join-Path $root 'apps\windows\THIRD-PARTY-NOTICES.txt') (Join-Path $stage 'Package\Notices\Windows-template-assets.txt')
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
$nativeCount = Initialize-DevelopmentLayout (Join-Path $stage 'Package') $Architecture
Write-Host "Validated $nativeCount native PE files and all manifest activation paths for $Architecture."
$zip = Join-Path $output "GamePack-windows-$Architecture.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
# Dependency archives can preserve Unix-epoch notice timestamps. ZIP supports
# only 1980 through 2107; change the staged copies, never dependency sources.
$zipMinimum = [datetime]::new(1980, 1, 2)
$zipMaximum = [datetime]::new(2107, 12, 30)
Get-ChildItem $stage -Recurse -Force | ForEach-Object {
    if ($_.LastWriteTime -lt $zipMinimum) { $_.LastWriteTime = $zipMinimum }
    elseif ($_.LastWriteTime -gt $zipMaximum) { $_.LastWriteTime = $zipMaximum }
}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zip.sha256", "$hash  GamePack-windows-$Architecture.zip`n", [Text.Encoding]::ASCII)
Write-Host "Release package: $zip"
