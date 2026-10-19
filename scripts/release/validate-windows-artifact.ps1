[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][ValidateSet('arm64','x64')][string]$Architecture,
    [Parameter(Mandatory)][string]$Version
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../../apps/windows/GamePack/Updater/update-core.psm1') -Force -DisableNameChecking
Expand-UpdateArchive $Archive $Destination
$layout = Test-UpdateLayout $Destination $Architecture (Get-StableVersion $Version)
[pscustomobject]@{version=$Version; architecture=$Architecture; dependencies=$layout.Dependencies.Count} | ConvertTo-Json -Compress
