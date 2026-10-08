[CmdletBinding()]
param([ValidateSet('Release', 'Debug')][string]$Configuration = 'Release', [switch]$SkipNpmInstall, [switch]$SkipTests, [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64')
$ErrorActionPreference = 'Stop'
$nativePlatform = if ($Architecture -eq 'arm64') { 'ARM64' } else { 'x64' }
$rustTarget = if ($Architecture -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
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
    Run 'rustup.exe' @('target', 'add', $rustTarget)
    if (-not $SkipTests) {
        Run 'cargo.exe' @('test', '--workspace', '--locked')
        Run 'npm.cmd' @('run', 'typecheck')
        Run 'npm.cmd' @('run', 'test:ui')
        Run 'cargo.exe' @('build', '--locked', '--bin', 'gamepack')
        & (Join-Path $PSScriptRoot 'test-contract.ps1') -CoreExecutable (Join-Path $root 'target\debug\gamepack.exe')
    }
    # Keep C++ and Rust on the dynamic MSVC runtime; staticlib includes the CXX wrapper.
    Run 'cargo.exe' @('build', '--locked', '--release', '--target', $rustTarget, '-p', 'gamepack-core')
    $bundle = Join-Path $root 'apps\windows\GamePack\Bundle'
    New-Item -ItemType Directory -Path $bundle -Force | Out-Null
    Run 'npx.cmd' @('--no-install', 'react-native', 'bundle', '--entry-file', 'index.js', '--platform', 'windows', '--dev', 'false', '--minify', 'true', '--bundle-output', (Join-Path $bundle 'index.windows.bundle'), '--assets-dest', $bundle)
    Run 'npx.cmd' @('--no-install', '@react-native-community/cli', 'autolink-windows', '--sln', 'apps\windows\GamePack.sln', '--proj', 'apps\windows\GamePack\GamePack.vcxproj')
    $msbuild = Join-Path $vs 'MSBuild\Current\Bin\MSBuild.exe'
    $packages = Join-Path $root "artifacts\windows\packages\$Architecture\"
    $rustLibDir = Join-Path $root "target\$rustTarget\release\"
    Run $msbuild @('apps\windows\GamePack.sln', '/restore', '/m', "/p:Configuration=$Configuration", "/p:Platform=$nativePlatform", "/p:GamePackRustLibDir=$rustLibDir", '/p:AppxBundle=Never', "/p:AppxBundlePlatforms=$nativePlatform", '/p:AppxPackageSigningEnabled=false', '/p:GenerateAppxPackageOnBuild=true', '/p:UapAppxPackageBuildMode=SideloadOnly', "/p:AppxPackageDir=$packages", '/verbosity:minimal', "/bl:artifacts\windows\build-$Architecture-$Configuration.binlog")
    Write-Host "Windows build complete: $packages. Install the development layout with scripts/windows/install.ps1."
} finally { Pop-Location }
