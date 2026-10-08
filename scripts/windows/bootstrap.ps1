# Installs source-build dependencies. Run from an elevated Windows PowerShell terminal.
[CmdletBinding()]
param([switch]$EnableDeveloperMode)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Run this script on Windows 10 2004 or later.' }
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install App Installer from Microsoft Store to get winget, then rerun this script.' }
function Install-Package([string]$Id, [string[]]$Extra = @()) {
    & winget install --id $Id --exact --accept-package-agreements --accept-source-agreements --disable-interactivity @Extra
    if ($LASTEXITCODE -notin @(0, -1978335189)) { throw "winget failed for $Id ($LASTEXITCODE)." }
}
Install-Package 'OpenJS.NodeJS.LTS'
Install-Package 'Rustlang.Rustup'
Install-Package 'Microsoft.VisualStudio.2022.BuildTools' @('--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Workload.UniversalBuildTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.VC.Tools.ARM64 --add Microsoft.VisualStudio.Component.UWP.VC.ARM64 --add Microsoft.VisualStudio.ComponentGroup.UWP.VC.BuildTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended')
if ($EnableDeveloperMode) {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'EnableDeveloperMode requires an elevated PowerShell terminal.' }
    $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name AllowDevelopmentWithoutDevLicense -Type DWord -Value 1
}
Write-Host 'Dependencies installed. Open a new terminal, then run scripts/windows/build.ps1 and scripts/windows/install.ps1.'
