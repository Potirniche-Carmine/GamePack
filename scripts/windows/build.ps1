[CmdletBinding()]
param([ValidateSet('Release', 'Debug')][string]$Configuration = 'Release', [switch]$SkipNpmInstall, [switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Visual Studio build tools are missing. Run scripts/windows/bootstrap.ps1.' }
$vs = & $vswhere -latest -products '*' -version '[17.0,18.0)' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio 2022 with C++ tools is required. Run scripts/windows/bootstrap.ps1.' }
$devcmd = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
# Import the x64 compiler/linker environment into this process; no persistent PATH changes.
& cmd.exe /d /s /c "call `"$devcmd`" -no_logo -arch=x64 -host_arch=x64 && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the Visual Studio environment.' }
function Run([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Exe failed with exit code $LASTEXITCODE." }
}
New-Item -ItemType Directory -Path (Join-Path $root 'artifacts\windows') -Force | Out-Null
Push-Location $root
try {
    if (-not $SkipNpmInstall) { Run 'npm.cmd' @('ci', '--no-audit', '--no-fund') }
    Run 'rustup.exe' @('default', 'stable-msvc')
    if (-not $SkipTests) {
        Run 'cargo.exe' @('test', '--workspace', '--locked')
        Run 'npm.cmd' @('run', 'typecheck')
    }
    # Keep C++ and Rust on the dynamic MSVC runtime; staticlib includes the CXX wrapper.
    Run 'cargo.exe' @('build', '--locked', '--release', '-p', 'gamepack-core')
    $bundle = Join-Path $root 'apps\windows\GamePack\Bundle'
    New-Item -ItemType Directory -Path $bundle -Force | Out-Null
    Run 'npx.cmd' @('--no-install', 'react-native', 'bundle', '--entry-file', 'index.js', '--platform', 'windows', '--dev', 'false', '--minify', 'true', '--bundle-output', (Join-Path $bundle 'index.windows.bundle'), '--assets-dest', $bundle)
    $msbuild = Join-Path $vs 'MSBuild\Current\Bin\MSBuild.exe'
    $packages = Join-Path $root 'artifacts\windows\packages\'
    Run $msbuild @('apps\windows\GamePack.sln', '/restore', '/m', "/p:Configuration=$Configuration", '/p:Platform=x64', '/p:AppxBundle=Never', '/p:AppxBundlePlatforms=x64', '/p:AppxPackageSigningEnabled=false', '/p:GenerateAppxPackageOnBuild=true', '/p:UapAppxPackageBuildMode=SideloadOnly', "/p:AppxPackageDir=$packages", '/verbosity:minimal', "/bl:artifacts\windows\build-$Configuration.binlog")
    Write-Host "Windows build complete: $packages. Install the development layout with scripts/windows/install.ps1."
} finally { Pop-Location }
