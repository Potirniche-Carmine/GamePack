[CmdletBinding()]
param([switch]$Build, [switch]$Launch, [ValidateSet('Release', 'Debug')][string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ($Build) { & (Join-Path $PSScriptRoot 'build.ps1') -Configuration $Configuration }
$developerMode = Get-ItemPropertyValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue
if ($developerMode -ne 1) { throw 'Source installation uses a development package. Enable Settings > System > For developers > Developer Mode, or run bootstrap.ps1 -EnableDeveloperMode from an elevated terminal.' }
# Register the package layout rather than trusting a new signing certificate.
$manifests = @(Get-ChildItem (Join-Path $root 'apps\windows\GamePack.Package') -Recurse -Filter AppxManifest.xml -ErrorAction SilentlyContinue)
$manifest = $manifests | Where-Object { $_.FullName -match "[\\/]$Configuration[\\/]" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $manifest) { throw 'No built package layout found. Run scripts/windows/build.ps1 first.' }
$dependencies = Get-ChildItem (Join-Path $root 'artifacts\windows\packages') -Recurse -Include '*.appx', '*.msix' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\\/]Dependencies[\\/]x64[\\/]' }
foreach ($dependency in $dependencies) { Add-AppxPackage -Path $dependency.FullName -ForceApplicationShutdown }
Add-AppxPackage -Register $manifest.FullName -ForceApplicationShutdown
$package = Get-AppxPackage -Name GamePack
if (-not $package) { throw 'GamePack registration did not return an installed package.' }
Write-Host "Installed GamePack ($($package.PackageFullName)). Data: GAMEPACK_HOME or $env:USERPROFILE\.gamepack"
if ($Launch) { Start-Process explorer.exe "shell:AppsFolder\$($package.PackageFamilyName)!App" }
