# Installs source-build dependencies. Run from an elevated Windows PowerShell terminal.
[CmdletBinding()]
param([switch]$EnableDeveloperMode)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Run this script on Windows 10 2004 or later.' }
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install App Installer from Microsoft Store to get winget, then rerun this script.' }
function Install-Package([string]$Id, [string[]]$Extra = @()) {
    & winget install --id $Id --exact --accept-package-agreements --accept-source-agreements --disable-interactivity @Extra
    if ($LASTEXITCODE -notin @(0, 3010, -1978335189)) { throw "winget failed for $Id ($LASTEXITCODE)." }
}
Install-Package 'OpenJS.NodeJS.LTS'
Install-Package 'Rustlang.Rustup'
$components = @(
    'Microsoft.VisualStudio.Workload.VCTools',
    'Microsoft.VisualStudio.Workload.UniversalBuildTools',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    'Microsoft.VisualStudio.Component.VC.Tools.ARM64',
    'Microsoft.VisualStudio.Component.UWP.VC.ARM64',
    'Microsoft.VisualStudio.ComponentGroup.UWP.VC.BuildTools',
    'Microsoft.VisualStudio.Component.Windows11SDK.22621'
)
$addComponents = ($components | ForEach-Object { "--add $_" }) -join ' '
Install-Package 'Microsoft.VisualStudio.2022.BuildTools' @('--override', "--wait --passive --norestart $addComponents --includeRecommended")
$installerDirectory = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
$vswhere = Join-Path $installerDirectory 'vswhere.exe'
$vsPath = & $vswhere -latest -products Microsoft.VisualStudio.Product.BuildTools -version '[17.0,18.0)' -property installationPath
if (-not $vsPath) { throw 'Visual Studio 2022 Build Tools installation was not found. Complete any requested restart, then rerun bootstrap.' }
$complete = & $vswhere -latest -products Microsoft.VisualStudio.Product.BuildTools -version '[17.0,18.0)' -requires @components -property installationPath
if (-not $complete) {
    # winget may skip an installed product. Modify it additively to fill missing components.
    # setup.exe does not support --wait; Start-Process -Wait waits for its process tree.
    $arguments = "modify --installPath `"$vsPath`" --channelId VisualStudio.17.Release --passive --norestart $addComponents --includeRecommended"
    $process = Start-Process -FilePath (Join-Path $installerDirectory 'setup.exe') -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -Wait -PassThru
    if ($process.ExitCode -notin @(0,3010)) { throw "Visual Studio component installation failed ($($process.ExitCode))." }
    $complete = & $vswhere -latest -products Microsoft.VisualStudio.Product.BuildTools -version '[17.0,18.0)' -requires @components -property installationPath
    if (-not $complete) { throw 'Required x64/ARM64/UWP/SDK components are still missing. Complete any requested restart and rerun bootstrap.' }
}
if ($EnableDeveloperMode) {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'EnableDeveloperMode requires an elevated PowerShell terminal.' }
    $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name AllowDevelopmentWithoutDevLicense -Type DWord -Value 1
}
Write-Host 'Dependencies installed. Open a new terminal, then run scripts/windows/build.ps1 and scripts/windows/install.ps1.'
