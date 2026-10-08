[CmdletBinding()]
param([switch]$Build, [switch]$Launch, [ValidateSet('Release', 'Debug')][string]$Configuration = 'Release', [string]$PackageDirectory, [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ($Build) { & (Join-Path $PSScriptRoot 'build.ps1') -Configuration $Configuration -Architecture $Architecture }
$developerMode = Get-ItemPropertyValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue
if ($developerMode -ne 1) { throw 'This unsigned package requires Settings > System > For developers > Developer Mode. Source users can also run bootstrap.ps1 -EnableDeveloperMode from an elevated terminal.' }
if (-not $PackageDirectory -and (Test-Path (Join-Path $PSScriptRoot 'Package\AppxManifest.xml'))) { $PackageDirectory = Join-Path $PSScriptRoot 'Package' }
if ($PackageDirectory) {
    $manifest = Get-Item (Join-Path $PackageDirectory 'AppxManifest.xml')
    $dependencyRoot = Join-Path (Split-Path $PackageDirectory -Parent) 'Dependencies'
} else {
    $manifests = @(Get-ChildItem (Join-Path $root 'apps\windows\GamePack.Package') -Recurse -Filter AppxManifest.xml -ErrorAction SilentlyContinue)
    $manifest = $manifests | Where-Object {
        if ($_.FullName -notmatch "[\\/]$Configuration[\\/]") { return $false }
        try {
            [xml]$layoutManifest = Get-Content -Raw $_.FullName
            $executable = $layoutManifest.Package.Applications.Application.Executable
            return $layoutManifest.Package.Identity.ProcessorArchitecture -eq $Architecture -and $executable -and (Test-Path (Join-Path $_.DirectoryName $executable))
        } catch { return $false }
    } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $dependencyRoot = Join-Path $root 'artifacts\windows\packages'
}
if (-not $manifest) { throw 'No compiled package layout found. Source users should run scripts/windows/build.ps1 first.' }
[xml]$layout = Get-Content -Raw $manifest.FullName
if (-not (Test-Path (Join-Path $manifest.DirectoryName $layout.Package.Applications.Application.Executable))) { throw 'Package layout is incomplete: the declared executable is missing.' }
$packageArchitecture = [string]$layout.Package.Identity.ProcessorArchitecture
$hostArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($packageArchitecture -eq 'arm64' -and $hostArchitecture -ne 'Arm64') { throw 'This package needs Windows on ARM64. Download the x64 package for an Intel or AMD PC.' }
$dependencies = Get-ChildItem $dependencyRoot -Recurse -Include '*.appx', '*.msix' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "[\\/]($packageArchitecture|neutral)[\\/]" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($dependency in $dependencies) {
    $archive = [IO.Compression.ZipFile]::OpenRead($dependency.FullName)
    try {
        $entry = $archive.GetEntry('AppxManifest.xml')
        if (-not $entry) { throw "Dependency package has no manifest: $($dependency.FullName)" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { [xml]$dependencyManifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $identity = $dependencyManifest.Package.Identity
        $alreadyInstalled = Get-AppxPackage -Name $identity.Name | Where-Object {
            [version]$_.Version -ge [version]$identity.Version -and
            ($_.Architecture.ToString() -eq $packageArchitecture -or $_.Architecture.ToString() -eq 'Neutral')
        } | Select-Object -First 1
        if (-not $alreadyInstalled) { Add-AppxPackage -Path $dependency.FullName -ForceApplicationShutdown }
    } finally { $archive.Dispose() }
}
$dataRoot = if ($env:GAMEPACK_HOME) { $env:GAMEPACK_HOME } else { Join-Path $env:USERPROFILE '.gamepack' }
if (-not [IO.Path]::IsPathRooted($dataRoot)) { throw 'GAMEPACK_HOME must be an absolute directory.' }
$destination = Join-Path $dataRoot 'app\windows'
$backup = Join-Path $dataRoot 'app\windows.previous'
$installed = Get-AppxPackage -Name GamePack
$previousManifest = if ($installed) { Join-Path $installed.InstallLocation 'AppxManifest.xml' } else { $null }
# Library data is outside this app subfolder and remains untouched during updates.
if ($installed) { $installed | Remove-AppxPackage }
New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
if (Test-Path $destination) { Move-Item $destination $backup }
try {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item (Join-Path $manifest.DirectoryName '*') -Destination $destination -Recurse -Force
    $nativeDirectory = Split-Path (Join-Path $destination $layout.Package.Applications.Application.Executable) -Parent
    [IO.File]::WriteAllText((Join-Path $nativeDirectory 'gamepack-root.txt'), [IO.Path]::GetFullPath($dataRoot), [Text.UTF8Encoding]::new($false))
    Add-AppxPackage -Register (Join-Path $destination 'AppxManifest.xml') -ForceApplicationShutdown
    $package = Get-AppxPackage -Name GamePack
    if (-not $package) { throw 'GamePack registration did not return an installed package.' }
} catch {
    if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
    if (Test-Path $backup) { Move-Item $backup $destination }
    if ($previousManifest -and (Test-Path $previousManifest)) { Add-AppxPackage -Register $previousManifest -ErrorAction Continue }
    throw
}
if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
Write-Host "Installed GamePack ($($package.PackageFullName)). App and library: $dataRoot"
if ($Launch) { Start-Process explorer.exe "shell:AppsFolder\$($package.PackageFamilyName)!App" }
