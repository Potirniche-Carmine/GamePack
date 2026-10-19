[CmdletBinding()]
param([string]$PackageDirectory, [ValidateSet('x64','arm64')][string]$Architecture = 'x64', [string]$Version)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Import-Module (Join-Path $root 'apps/windows/GamePack/Updater/update-core.psm1') -Force -DisableNameChecking
$testTempRoot = [IO.Path]::GetTempPath()
# macOS exposes /var as a symlink; fixtures use its canonical spelling because production rejects linked roots.
if ($testTempRoot.StartsWith('/var/')) { $testTempRoot = '/private' + $testTempRoot }
$temporary = Join-Path $testTempRoot ('gamepack-update-tests-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporary) | Out-Null
$script:checks = 0
function Assert([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message }; $script:checks++ }
function Reject([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert $rejected $Message
}
function Put([string]$Path, [string]$Text) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Write-Pe([string]$Path, [string]$Arch) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    $stream = [IO.File]::Create($Path); $writer = [IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0x5a4d); $stream.SetLength(70); $stream.Position=0x3c; $writer.Write([int]64)
        $stream.Position=64; $writer.Write([uint32]0x4550); $writer.Write([uint16]$(if($Arch -eq 'arm64'){0xaa64}else{0x8664}))
    } finally { $writer.Dispose() }
}
function New-Fixture([string]$Directory, [string]$Arch = 'x64') {
    $manifest = @"
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Identity Name="GamePack" Publisher="CN=GamePack" Version="1.0.1.0" ProcessorArchitecture="$Arch"/><Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0"/></Dependencies><Applications><Application Id="App" Executable="GamePack\GamePack.exe" EntryPoint="Windows.FullTrustApplication"/></Applications></Package>
"@
    Put (Join-Path $Directory 'Package/AppxManifest.xml') $manifest
    Write-Pe (Join-Path $Directory 'Package/GamePack/GamePack.exe') $Arch
    Write-Pe (Join-Path $Directory 'Package/GamePack/Microsoft.ReactNative.dll') $Arch
    Put (Join-Path $Directory 'Package/GamePack/Bundle/index.windows.bundle') 'fixture'
    Put (Join-Path $Directory 'Package/GamePack/Updater/update-helper.ps1') 'throw "Downloaded code must never run"'
    Put (Join-Path $Directory 'Package/GamePack/Updater/update-core.psm1') 'throw "Downloaded code must never run"'
    Put (Join-Path $Directory 'install.ps1') 'throw "Downloaded installer must never run"'
}
function New-Zip([string]$Path, [string[]]$Names, [switch]$Link) {
    $stream = [IO.File]::Create($Path); $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Names) {
            $entry = $zip.CreateEntry($name)
            if ($Link) { $entry.ExternalAttributes = -1577058304 } # Unix S_IFLNK | 0777.
            $writer = [IO.StreamWriter]::new($entry.Open()); try { $writer.Write('fixture') } finally { $writer.Dispose() }
        }
    } finally { $zip.Dispose(); $stream.Dispose() }
}
try {
    Assert ((Assert-NewerVersion 'v1.0.1+build.2' '1.0.0').ToString() -eq '1.0.1.0') 'Stable version metadata was not normalized.'
    foreach ($value in @('1.0.0','0.9.9','v1.0.1-beta','v01.0.1','v1.2','1.0.1/evil','1.0.1?x',"1.0.1`n",'65536.1.0','9999999999999999999.0.0')) { Reject { Assert-NewerVersion $value '1.0.0' } "Accepted invalid or non-newer version $value" }
    $hash = 'ab' * 32; $name = 'GamePack-windows-x64.zip'; $base = 'https://github.com/Potirniche-Carmine/GamePack/releases/download/v1.0.1/'
    $release = [pscustomobject]@{tag_name='v1.0.1';draft=$false;prerelease=$false;assets=@([pscustomobject]@{name=$name;state='uploaded';size=500;digest="sha256:$hash";browser_download_url=$base+$name})}
    $selection = Get-ReleaseSelection $release 'v1.0.1' 'x64'
    Assert ($selection.Digest -ceq $hash) 'Metadata digest was not accepted.'
    Reject { Get-ReleaseSelection $release 'v1.0.2' 'x64' } 'Wrong tag accepted.'
    Reject { Get-ReleaseSelection $release 'v1.0.1' 'arm64' } 'Wrong architecture accepted.'
    $release.draft=$true; Reject { Get-ReleaseSelection $release 'v1.0.1' 'x64' } 'Draft accepted.'; $release.draft=$false
    $release.prerelease=$true; Reject { Get-ReleaseSelection $release 'v1.0.1' 'x64' } 'Prerelease accepted.'; $release.prerelease=$false
    $release.assets[0].browser_download_url='https://evil.invalid/update.zip'; Reject { Get-ReleaseSelection $release 'v1.0.1' 'x64' } 'Arbitrary download URL accepted.'; $release.assets[0].browser_download_url=$base+$name
    $release.assets[0].digest=$null; Reject { Get-ReleaseSelection $release 'v1.0.1' 'x64' } 'Missing checksum accepted.'
    $release.assets += [pscustomobject]@{name="$name.sha256";state='uploaded';size=95;browser_download_url=$base+$name+'.sha256'}
    Assert ($null -ne (Get-ReleaseSelection $release 'v1.0.1' 'x64').Checksum) 'Checksum fallback rejected.'
    Assert ((Read-Checksum "$hash  $name`n" $name) -ceq $hash) 'Valid checksum rejected.'
    Reject { Read-Checksum "$hash  evil.zip`n" $name } 'Checksum for a different file accepted.'
    Reject { Read-Checksum "$hash  $name`n$hash  $name`n" $name } 'Duplicate checksum entries accepted.'
    $file = Join-Path $temporary 'hash.bin'; Put $file 'good'; $realHash = (Get-FileHash $file -Algorithm SHA256).Hash
    Assert-UpdateHash $file $realHash; Put $file 'corrupt'; Reject { Assert-UpdateHash $file $realHash } 'Corrupt download accepted.'
    $state = Join-Path $temporary 'state.json'; Write-UpdateJson $state @{status='downloading';version='1.0.1'}; Write-UpdateJson $state @{status='ready';version='1.0.1'}
    Assert ((Read-UpdateJson $state).status -ceq 'ready') 'State was not persisted atomically.'
    $paths = @('../escape','Package/../../escape','/absolute','C:\escape','Package\..\escape','Package/file:stream','Package/CON.txt','Package/file.','Package/folder /x','Package//file','Package/./file',"Package/a`nb")
    $index = 0
    foreach ($path in $paths) {
        $index++; $zip = Join-Path $temporary "bad-$index.zip"; New-Zip $zip @($path)
        Reject { Expand-UpdateArchive $zip (Join-Path $temporary "bad-$index") } "Unsafe ZIP path accepted: $path"
    }
    $zip=Join-Path $temporary 'collision.zip'; New-Zip $zip @('Package\file.txt','package/file.txt')
    Reject { Expand-UpdateArchive $zip (Join-Path $temporary 'collision') } 'Case/separator path collision accepted.'
    $zip=Join-Path $temporary 'link.zip'; New-Zip $zip @('Package/link') -Link
    Reject { Expand-UpdateArchive $zip (Join-Path $temporary 'link') } 'ZIP symlink accepted.'
    $zip=Join-Path $temporary 'backslash.zip'; New-Zip $zip @('Package\file.txt')
    Expand-UpdateArchive $zip (Join-Path $temporary 'backslash')
    Assert ([IO.File]::Exists((Join-Path $temporary 'backslash/Package/file.txt'))) 'Existing release ZIP backslashes were not accepted.'
    foreach ($arch in @('x64','arm64')) {
        $fixture=Join-Path $temporary "valid-$arch"; New-Fixture $fixture $arch
        $layout=Test-UpdateLayout $fixture $arch ([version]'1.0.1.0')
        Assert ([IO.File]::Exists($layout.Executable)) "$arch package failed validation."
        Reject { Test-UpdateLayout $fixture $arch ([version]'1.0.2.0') } 'Wrong manifest version accepted.'
        $other=if($arch -eq 'x64'){'arm64'}else{'x64'}
        Write-Pe (Join-Path $fixture 'Package/GamePack/unexpected.dll') $other
        Reject { Test-UpdateLayout $fixture $arch ([version]'1.0.1.0') } 'Wrong architecture unregistered DLL accepted.'
        Remove-Item (Join-Path $fixture 'Package/GamePack/unexpected.dll')
        $manifestPath=Join-Path $fixture 'Package/AppxManifest.xml'; $original=[IO.File]::ReadAllText($manifestPath)
        Put $manifestPath ($original.Replace('CN=GamePack','CN=Other'))
        Reject { Test-UpdateLayout $fixture $arch ([version]'1.0.1.0') } 'Wrong publisher accepted.'
        Put $manifestPath ($original.Replace('GamePack\GamePack.exe','..\outside.exe'))
        Reject { Test-UpdateLayout $fixture $arch ([version]'1.0.1.0') } 'Manifest traversal accepted.'
        Put $manifestPath '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Package>&xxe;</Package>'
        Reject { Test-UpdateLayout $fixture $arch ([version]'1.0.1.0') } 'External entity accepted.'
    }
    $dependencyFixture=Join-Path $temporary 'dependency';New-Fixture $dependencyFixture
    $manifestPath=Join-Path $dependencyFixture 'Package/AppxManifest.xml'
    $manifest=[IO.File]::ReadAllText($manifestPath).Replace('</Dependencies>','<PackageDependency Name="Microsoft.Fixture" MinVersion="1.0.0.0" Publisher="CN=Microsoft Fixture"/></Dependencies>')
    Put $manifestPath $manifest
    Reject { Test-UpdateLayout $dependencyFixture 'x64' ([version]'1.0.1.0') } 'A missing framework was accepted.'
    $dependencyPath=Join-Path $dependencyFixture 'Dependencies/x64/framework.appx'
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dependencyPath)) | Out-Null
    foreach($publisher in @('CN=Other','CN=Microsoft Fixture')) {
        if(Test-Path -LiteralPath $dependencyPath){Remove-Item -LiteralPath $dependencyPath}
        $stream=[IO.File]::Create($dependencyPath);$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
        try {
            $entry=$zip.CreateEntry('AppxManifest.xml');$writer=[IO.StreamWriter]::new($entry.Open())
            try{$writer.Write('<Package><Identity Name="Microsoft.Fixture" Version="1.0.0.0" Publisher="'+$publisher+'" ProcessorArchitecture="x64"/></Package>')}finally{$writer.Dispose()}
        } finally {$zip.Dispose();$stream.Dispose()}
        if($publisher -eq 'CN=Other') {Reject { Test-UpdateLayout $dependencyFixture 'x64' ([version]'1.0.1.0') } 'A framework with a different publisher was accepted.'}
        else {Assert ((Test-UpdateLayout $dependencyFixture 'x64' ([version]'1.0.1.0')).Dependencies.Count -eq 1) 'A valid framework dependency was rejected.'}
    }
    Reject { Receive-UpdateFile 'http://github.com/file.zip' (Join-Path $temporary 'invalid-download') 10 } 'Insecure HTTP download was accepted.'
    Reject { Receive-UpdateFile 'https://evil.invalid/file.zip' (Join-Path $temporary 'invalid-download') 10 } 'An arbitrary download host was accepted.'
    $inputStream=[IO.MemoryStream]::new([byte[]](1,2,3,4)); $outputStream=[IO.MemoryStream]::new()
    try {
        Reject { Copy-BoundedEntry $inputStream $outputStream 1 } 'Inflation beyond the declared size was accepted.'
        Assert ($outputStream.Length -eq 0) 'Oversized inflated bytes were written before rejection.'
    } finally { $inputStream.Dispose(); $outputStream.Dispose() }
    $permission=Join-Path $temporary 'permission'; [IO.Directory]::CreateDirectory($permission) | Out-Null
    Reject { Wait-UpdatePermission $permission 42 1 } 'An unacknowledged restart was accepted.'
    Write-UpdateJson (Join-Path $permission 'install-permitted.json') @{workerPid=43}
    Reject { Wait-UpdatePermission $permission 42 1 } 'Restart permission for a different worker was accepted.'
    Write-UpdateJson (Join-Path $permission 'install-permitted.json') @{workerPid=42}
    Wait-UpdatePermission $permission 42 1
    Put (Join-Path $permission 'cancel-install') 'cancel'
    Reject { Wait-UpdatePermission $permission 42 1 } 'Cancelled restart permission was accepted.'
    $self=Get-Process -Id $PID
    $parentRequest=[pscustomobject]@{parentPid=$PID;parentStart=$self.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();executable=$self.Path}
    Assert ((Get-ExactParentProcess $parentRequest).Id -eq $PID) 'Exact process identity was rejected.'
    $parentRequest.parentStart='1'; Reject { Get-ExactParentProcess $parentRequest } 'A reused process ID was accepted.'
    $parentRequest.parentStart=$self.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();$parentRequest.executable='wrong.exe'
    Reject { Get-ExactParentProcess $parentRequest } 'A different app process was accepted.'
    $managed=Join-Path $temporary 'managed';$destination=Join-Path $managed 'app/windows'; New-Fixture (Join-Path $managed 'source')
    [IO.Directory]::CreateDirectory((Join-Path $managed 'app')) | Out-Null
    [IO.Directory]::Move((Join-Path $managed 'source/Package'),$destination)
    $managedRequest=[pscustomobject]@{dataRoot=$managed;executable=(Join-Path $destination 'GamePack/GamePack.exe');currentVersion='1.0.1'}
    $script:mockPackage=[pscustomobject]@{Publisher='CN=GamePack';InstallLocation=$destination;Version='1.0.1.0'}
    $query={return $script:mockPackage};$enabled={return 1};$disabled={return 0}
    Assert ($null -ne (Assert-ManagedInstallation $managedRequest $query $enabled)) 'Managed installation guard rejected the expected package.'
    Reject { Assert-ManagedInstallation $managedRequest $query $disabled } 'Disabled Developer Mode was accepted.'
    $script:mockPackage.Version='1.0.2.0'; Reject { Assert-ManagedInstallation $managedRequest $query $enabled } 'A newer externally installed package was overwritten.'
    $script:mockPackage.Version='1.0.1.0';$script:mockPackage.InstallLocation=Join-Path $managed 'other'
    Reject { Assert-ManagedInstallation $managedRequest $query $enabled } 'A different registered installation was accepted.'
    $script:mockPackage.InstallLocation=$destination;$script:mockPackage.Publisher='CN=Other'
    Reject { Assert-ManagedInstallation $managedRequest $query $enabled } 'A different installed publisher was accepted.'
    $script:mockPackage.Publisher='CN=GamePack';$managedRequest.executable=Join-Path $managed 'other/GamePack.exe'
    Reject { Assert-ManagedInstallation $managedRequest $query $enabled } 'An unmanaged app executable was accepted.'
    foreach ($scenario in @('success','register-failure','verify-failure','unregister-failure')) {
        $folder=Join-Path $temporary $scenario; $destination=Join-Path $folder 'app/windows'; $prepared=Join-Path $folder 'staged'; $backup=Join-Path $folder 'app/backup'
        Put (Join-Path $destination 'AppxManifest.xml') 'old'; Put (Join-Path $destination 'stale.dll') 'old'; Put (Join-Path $prepared 'AppxManifest.xml') 'new'; Put (Join-Path $folder 'gamepack.sqlite3') 'library sentinel'
        $script:registered='old'; $script:unregisterCount=0
        $unregister={ $script:unregisterCount++; if($scenario -eq 'unregister-failure' -and $script:unregisterCount -eq 1){throw 'OS unregister failure'}; $script:registered=$null }
        $register={param($path) $value=[IO.File]::ReadAllText($path); if($scenario -eq 'register-failure' -and $value -eq 'new'){throw 'OS register failure'}; $script:registered=$value}
        $verify={if($scenario -eq 'verify-failure'){throw 'OS verification failure'}; if($script:registered -ne 'new'){throw 'Not registered'}}
        if($scenario -eq 'success') {
            Invoke-UpdateReplacement $destination $prepared $backup $unregister $register $verify
            Assert ($script:registered -ceq 'new') 'New registration missing.'
            Assert (-not (Test-Path (Join-Path $destination 'stale.dll'))) 'Stale app resource survived replacement.'
        } else {
            Reject { Invoke-UpdateReplacement $destination $prepared $backup $unregister $register $verify } "Failure was swallowed: $scenario"
            Assert ($script:registered -ceq 'old' -and [IO.File]::ReadAllText((Join-Path $destination 'AppxManifest.xml')) -ceq 'old') "Old app or registration not restored: $scenario"
        }
        Assert ([IO.File]::ReadAllText((Join-Path $folder 'gamepack.sqlite3')) -ceq 'library sentinel') 'Library changed during replacement.'
        Assert (-not (Test-Path -LiteralPath $backup)) 'Backup was not consumed after success or restoration.'
    }
    if ($PackageDirectory) {
        if (-not $Version) { $Version=(Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version }
        $layout=Test-UpdateLayout $PackageDirectory $Architecture (Get-StableVersion $Version)
        Assert ([IO.File]::Exists($layout.Executable)) 'Real package layout validation failed.'
    }
    Write-Host "Windows updater validation passed ($script:checks assertions)."
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
