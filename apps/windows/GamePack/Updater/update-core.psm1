# Trusted code bundled with the running app. Downloaded installer scripts are never loaded.
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 does not automatically load ZipArchive with the FileSystem facade.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Net.Http

function Get-StableVersion([string]$Value) {
    if ($Value.Length -gt 256 -or $Value -cnotmatch '^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z') { throw 'The update version is invalid.' }
    $parts = @($Matches[1], $Matches[2], $Matches[3])
    foreach ($part in $parts) { if ($part.Length -gt 5 -or [int]$part -gt 65535) { throw 'This update version is unsupported on Windows.' } }
    return [version](($parts -join '.') + '.0')
}
function Assert-NewerVersion([string]$Candidate, [string]$Installed) {
    $version = Get-StableVersion $Candidate
    if ($version -le (Get-StableVersion $Installed)) { throw 'This update is not newer than the installed app.' }
    return $version
}
function Write-UpdateJson([string]$Path, $Value) {
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12 -Compress), [Text.UTF8Encoding]::new($false))
    try {
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function Read-UpdateJson([string]$Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        if ($stream.Length -gt 1048576) { throw 'The update state is invalid.' }
        $reader = [IO.StreamReader]::new($stream)
        try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}
function Assert-PlainPath([string]$Path) {
    $item = [IO.Path]::GetFullPath($Path)
    while ($item) {
        if (Test-Path -LiteralPath $item) {
            if (((Get-Item -LiteralPath $item -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Updates cannot use linked folders. Reinstall GamePack in its managed folder.' }
        }
        $parent = [IO.Path]::GetDirectoryName($item)
        if ($parent -eq $item) { break }; $item = $parent
    }
}
function Get-SafeRelativePath([string]$Root, [string]$Relative) {
    $name = $Relative.Replace('\', '/')
    if (-not $name -or $name.StartsWith('/') -or $name -match '[\x00-\x1f\x7f:<>"|?*]') { throw 'The update contains an unsafe path.' }
    $parts = $name.TrimEnd('/').Split('/')
    foreach ($part in $parts) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'The update contains an unsafe path.' }
    }
    $relativePath = $parts -join [IO.Path]::DirectorySeparatorChar
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $full = [IO.Path]::GetFullPath((Join-Path $Root $relativePath))
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'The update contains an unsafe path.' }
    return $full
}
function Copy-BoundedEntry([IO.Stream]$InputStream, [IO.Stream]$OutputStream, [long]$ExpectedLength) {
    $buffer = [byte[]]::new(65536); [long]$written = 0
    while (($count = $InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $written += $count
        if ($written -gt $ExpectedLength -or $written -gt 268435456) { throw 'The expanded update is larger than declared.' }
        $OutputStream.Write($buffer, 0, $count)
    }
    if ($written -ne $ExpectedLength) { throw 'The update archive is incomplete.' }
}
function Expand-UpdateArchive([string]$Archive, [string]$Destination) {
    if ((Get-Item -LiteralPath $Archive).Length -gt 536870912) { throw 'The update archive is too large.' }
    if (Test-Path -LiteralPath $Destination) { throw 'The update staging folder already exists.' }
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -gt 20000) { throw 'The update contains too many files.' }
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $target = Get-SafeRelativePath $Destination $entry.FullName
            if (-not $names.Add($target)) { throw 'The update contains duplicate file paths.' }
            $type = ($entry.ExternalAttributes -shr 16) -band 0xF000
            if ($type -notin @(0, 0x8000, 0x4000) -or ($entry.ExternalAttributes -band 0x400) -ne 0) { throw 'The update contains a link or special file.' }
            $total += $entry.Length
            if ($entry.Length -gt 268435456 -or $total -gt 2147483648) { throw 'The expanded update is too large.' }
            if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) {
                if ($entry.Length -ne 0) { throw 'The update contains an invalid directory.' }
                [IO.Directory]::CreateDirectory($target) | Out-Null; continue
            }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            $inputStream = $entry.Open(); $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew)
            try { Copy-BoundedEntry $inputStream $outputStream $entry.Length } finally { $outputStream.Dispose(); $inputStream.Dispose() }
            if ((Get-Item -LiteralPath $target).Length -ne $entry.Length) { throw 'The update archive is incomplete.' }
        }
    } finally { $zip.Dispose() }
}
function Read-SafeXml([IO.Stream]$Stream) {
    $settings = [Xml.XmlReaderSettings]::new(); $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null; $settings.MaxCharactersInDocument = 1048576
    $reader = [Xml.XmlReader]::Create($Stream, $settings)
    try { $document = [Xml.XmlDocument]::new(); $document.XmlResolver = $null; $document.Load($reader); return ,$document }
    finally { $reader.Dispose() }
}
function Read-UpdateManifest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try { return Read-SafeXml $stream } finally { $stream.Dispose() }
}
function Assert-UpdatePe([string]$Path, [string]$Architecture) {
    $stream = [IO.File]::OpenRead($Path); $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { throw 'The update contains an invalid executable.' }
        $stream.Position = 0x3c; $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset -gt $stream.Length - 6) { throw 'The update contains an invalid executable.' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550) { throw 'The update contains an invalid executable.' }
        $expected = if ($Architecture -eq 'arm64') { 0xaa64 } else { 0x8664 }
        if ($reader.ReadUInt16() -ne $expected) { throw 'The update does not match this computer architecture.' }
    } finally { $reader.Dispose() }
}
function Get-UpdateDependency([string]$Path) {
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entries = @($zip.Entries | Where-Object { $_.FullName -ceq 'AppxManifest.xml' })
        if ($entries.Count -ne 1 -or $entries[0].Length -gt 1048576) { throw 'An update dependency has an invalid manifest.' }
        $stream = $entries[0].Open()
        try { $document = Read-SafeXml $stream; return $document.Package.Identity } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
}
function Test-UpdateLayout([string]$Directory, [string]$Architecture, [version]$Version) {
    if ($Architecture -notin @('arm64','x64')) { throw 'Unsupported update architecture.' }
    $package = Join-Path $Directory 'Package'
    $document = Read-UpdateManifest (Join-Path $package 'AppxManifest.xml')
    $identity = $document.Package.Identity
    if ($identity.Name -cne 'GamePack' -or $identity.Publisher -cne 'CN=GamePack' -or [version]$identity.Version -ne $Version -or $identity.ProcessorArchitecture -cne $Architecture) { throw 'The update package identity does not match this app.' }
    $apps = @($document.Package.Applications.Application)
    if ($apps.Count -ne 1 -or $apps[0].Id -cne 'App' -or $apps[0].EntryPoint -cne 'Windows.FullTrustApplication') { throw 'The update application identity is invalid.' }
    $executable = Get-SafeRelativePath $package $apps[0].Executable
    if (-not [IO.File]::Exists($executable) -or [IO.Path]::GetExtension($executable) -ine '.exe') { throw 'The update executable is missing.' }
    $nativeDirectory = [IO.Path]::GetDirectoryName($executable)
    foreach ($relative in @('Bundle/index.windows.bundle','Updater/update-helper.ps1','Updater/update-core.psm1')) {
        if (-not [IO.File]::Exists((Get-SafeRelativePath $nativeDirectory $relative))) { throw 'The update is missing required application files.' }
    }
    if (-not @(Get-ChildItem -LiteralPath $package -Recurse -Filter Microsoft.ReactNative.dll).Count) { throw 'The update runtime is missing.' }
    foreach ($server in $document.SelectNodes('//*[local-name()="InProcessServer"]/*[local-name()="Path"]')) {
        $serverPath = Get-SafeRelativePath $package $server.InnerText
        if (-not [IO.File]::Exists($serverPath)) { throw 'The update has an invalid activation path.' }
    }
    foreach ($file in Get-ChildItem -LiteralPath $package -Recurse -File) {
        if ($file.Extension -in @('.exe','.dll')) { Assert-UpdatePe $file.FullName $Architecture }
    }
    $dependencies = @()
    $dependencyRoot = Join-Path $Directory 'Dependencies'
    if (Test-Path -LiteralPath $dependencyRoot) {
        foreach ($file in Get-ChildItem -LiteralPath $dependencyRoot -Recurse -File) {
            if ($file.Extension -notin @('.appx','.msix')) { throw 'The update contains an unexpected dependency file.' }
            $dep = Get-UpdateDependency $file.FullName
            $requirements = @($document.Package.Dependencies.PackageDependency | Where-Object { $_ -and $_.Name -and $_.Name -ceq $dep.Name -and $_.Publisher -and $_.Publisher -ceq $dep.Publisher -and [version]$dep.Version -ge [version]$_.MinVersion })
            if (-not $requirements.Count -or $dep.ProcessorArchitecture -notin @($Architecture,'neutral')) { throw 'An update dependency identity does not match the app manifest.' }
            $dependencies += [pscustomobject]@{Path=$file.FullName; Identity=$dep}
        }
    }
    foreach ($required in @($document.Package.Dependencies.PackageDependency)) {
        if ($required -and $required.Name -and -not @($dependencies | Where-Object { $_.Identity.Name -ceq $required.Name }).Count) { throw 'The update is missing a runtime dependency.' }
    }
    return [pscustomobject]@{Package=$package; Executable=$executable; Manifest=$document; Dependencies=$dependencies}
}
function Assert-UpdateHash([string]$Path, [string]$Expected) {
    if ($Expected -cnotmatch '^[0-9a-fA-F]{64}$' -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Expected) { throw 'The update checksum does not match. Download the update again.' }
}
function Get-ReleaseSelection($Release, [string]$Tag, [string]$Architecture) {
    if ($Release.tag_name -cne $Tag -or $Release.draft -isnot [bool] -or $Release.prerelease -isnot [bool] -or $Release.draft -ne $false -or $Release.prerelease -ne $false) { throw 'This update is not a published stable release.' }
    $name = "GamePack-windows-$Architecture.zip"
    $assets = @($Release.assets | Where-Object { $_.name -ceq $name -and $_.state -ceq 'uploaded' })
    if ($assets.Count -ne 1 -or [long]$assets[0].size -le 0 -or [long]$assets[0].size -gt 536870912) { throw 'A valid update download is not available for this computer.' }
    $base = 'https://github.com/Potirniche-Carmine/GamePack/releases/download/' + [Uri]::EscapeDataString($Tag) + '/'
    if ($assets[0].browser_download_url -cne ($base + $name)) { throw 'The update download address is invalid.' }
    $digest = $null
    if ($assets[0].digest) {
        if ($assets[0].digest -cnotmatch '^sha256:([a-fA-F0-9]{64})$') { throw 'The update checksum is invalid.' }
        $digest = $Matches[1]
    }
    $checksums = @($Release.assets | Where-Object { $_.name -ceq "$name.sha256" -and $_.state -ceq 'uploaded' })
    if ($checksums.Count -gt 1) { throw 'The update has duplicate checksum files.' }
    if ($checksums.Count -eq 1 -and ($checksums[0].browser_download_url -cne ($base + "$name.sha256") -or $checksums[0].size -le 0 -or $checksums[0].size -gt 4096)) { throw 'The update checksum file is invalid.' }
    if (-not $digest -and -not $checksums.Count) { throw 'The update has no verification checksum.' }
    return [pscustomobject]@{Name=$name; Url=$base+$name; Size=[long]$assets[0].size; Digest=$digest; Checksum=if($checksums.Count){$checksums[0]}else{$null}}
}
function Read-Checksum([string]$Text, [string]$Name) {
    if ($Text -cnotmatch ('^([a-fA-F0-9]{64}) [ *]' + [regex]::Escape($Name) + '\r?\n?$')) { throw 'The update checksum file is invalid.' }
    return $Matches[1]
}
function Receive-UpdateFile([string]$Url, [string]$Path, [long]$MaximumBytes, [long]$ExpectedBytes = 0, [scriptblock]$Progress = {}) {
    $handler = [Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler); $client.Timeout = [TimeSpan]::FromMinutes(15)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('GamePack-Updater/1.0')
    $client.DefaultRequestHeaders.Accept.ParseAdd('application/vnd.github+json')
    $response = $null
    try {
        for ($redirect = 0; $redirect -le 5; $redirect++) {
            $uri = [Uri]$Url
            if ($uri.Scheme -cne 'https' -or $uri.UserInfo -or -not $uri.IsDefaultPort -or $uri.Host -notin @('api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com')) { throw 'The update download was redirected to an unexpected address.' }
            $response = $client.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            if ([int]$response.StatusCode -in @(301,302,303,307,308)) {
                $location = $response.Headers.Location
                if (-not $location) { throw 'The update download redirect is invalid.' }
                $Url = ([Uri]::new($uri, $location)).AbsoluteUri
                $response.Dispose(); $response = $null; continue
            }
            break
        }
        if (-not $response -or [int]$response.StatusCode -ne 200) { throw 'The update could not be downloaded. Try again later.' }
        $length = $response.Content.Headers.ContentLength
        if ($length -and ($length -gt $MaximumBytes -or ($ExpectedBytes -and $length -ne $ExpectedBytes))) { throw 'The update download size is invalid.' }
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
        try {
            $buffer = [byte[]]::new(65536); [long]$total = 0; $last = [datetime]::UtcNow
            while ($true) {
                $read = $inputStream.ReadAsync($buffer, 0, $buffer.Length)
                if (-not $read.Wait(60000)) { throw 'The update download timed out. Try again.' }
                $count = $read.GetAwaiter().GetResult(); if ($count -eq 0) { break }
                $total += $count
                if ($total -gt $MaximumBytes -or ($ExpectedBytes -and $total -gt $ExpectedBytes)) { throw 'The update download is too large.' }
                $outputStream.Write($buffer,0,$count)
                if ($ExpectedBytes -and ([datetime]::UtcNow - $last).TotalMilliseconds -ge 500) { & $Progress ($total / [double]$ExpectedBytes); $last = [datetime]::UtcNow }
            }
            if ($ExpectedBytes -and $total -ne $ExpectedBytes) { throw 'The update download is incomplete.' }
        } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    } finally { if ($response) { $response.Dispose() }; $client.Dispose(); $handler.Dispose() }
}
function Assert-ManagedInstallation($Request, [scriptblock]$GetPackage = { Get-AppxPackage -Name GamePack }, [scriptblock]$GetDeveloperMode = { Get-ItemPropertyValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue }) {
    $root = [IO.Path]::GetFullPath($Request.dataRoot)
    if (-not [IO.Path]::IsPathRooted($Request.dataRoot)) { throw 'The GamePack library folder is invalid.' }
    $destination = Join-Path $root 'app/windows'
    Assert-PlainPath $destination
    $manifest = Read-UpdateManifest (Join-Path $destination 'AppxManifest.xml')
    $expectedExecutable = Get-SafeRelativePath $destination $manifest.Package.Applications.Application.Executable
    if (-not $expectedExecutable.Equals([IO.Path]::GetFullPath($Request.executable), [StringComparison]::OrdinalIgnoreCase)) { throw 'Install GamePack with its bundled installer before updating in the app.' }
    $installed = @(& $GetPackage)
    if ($installed.Count -ne 1 -or $installed[0].Publisher -cne 'CN=GamePack' -or -not ([IO.Path]::GetFullPath($installed[0].InstallLocation)).Equals($destination, [StringComparison]::OrdinalIgnoreCase) -or $manifest.Package.Identity.Name -cne 'GamePack' -or $manifest.Package.Identity.Publisher -cne 'CN=GamePack' -or [version]$manifest.Package.Identity.Version -ne (Get-StableVersion $Request.currentVersion) -or [version]$installed[0].Version -ne (Get-StableVersion $Request.currentVersion)) { throw 'Install GamePack with its bundled installer before updating in the app.' }
    $developerMode = & $GetDeveloperMode
    if ($developerMode -ne 1) { throw 'Developer Mode must be enabled to update this unsigned Windows app.' }
    return $installed[0]
}
function Get-ExactParentProcess($Request) {
    $process = Get-Process -Id $Request.parentPid -ErrorAction Stop
    if ($process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -cne [string]$Request.parentStart -or -not $process.Path.Equals($Request.executable, [StringComparison]::OrdinalIgnoreCase)) { throw 'The app process changed. Restart GamePack and try again.' }
    return $process
}
function Wait-UpdatePermission([string]$Transaction, [int]$WorkerId, [int]$TimeoutMilliseconds = 60000) {
    $permissionPath = Join-Path $Transaction 'install-permitted.json'
    $cancelPath = Join-Path $Transaction 'cancel-install'
    $deadline = [datetime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    while (-not (Test-Path -LiteralPath $permissionPath)) {
        if ([datetime]::UtcNow -ge $deadline -or (Test-Path -LiteralPath $cancelPath)) { throw 'The restart was cancelled. Try again.' }
        Start-Sleep -Milliseconds 50
    }
    if ((Test-Path -LiteralPath $cancelPath) -or (Read-UpdateJson $permissionPath).workerPid -ne $WorkerId) { throw 'The restart permission is invalid. Try again.' }
}
# Hooks isolate OS registration from the filesystem transaction, allowing real rollback fixtures.
function Invoke-UpdateReplacement([string]$Destination, [string]$Prepared, [string]$Backup, [scriptblock]$Unregister, [scriptblock]$Register, [scriptblock]$Verify) {
    if (Test-Path -LiteralPath $Backup) { throw 'A previous update needs recovery before continuing.' }
    $moved = $false; $registered = $false; $unregisterAttempted = $false
    try {
        $unregisterAttempted = $true; & $Unregister
        [IO.Directory]::Move($Destination, $Backup); $moved = $true
        [IO.Directory]::Move($Prepared, $Destination)
        & $Register (Join-Path $Destination 'AppxManifest.xml'); $registered = $true
        & $Verify
    } catch {
        $originalError = $_
        try {
            if ($moved) {
                # Also remove a partial registration after Add-AppxPackage threw.
                & $Unregister
                if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
                [IO.Directory]::Move($Backup, $Destination)
            }
            if ($unregisterAttempted) { & $Register (Join-Path $Destination 'AppxManifest.xml') }
        } catch { throw 'The update could not be installed or restored. Your library is unchanged; reinstall GamePack with its bundled installer.' }
        throw $originalError
    }
    # Registration is now committed. A launch failure does not roll back a version that may have opened SQLite.
    if ($registered -and (Test-Path -LiteralPath $Backup)) { Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue }
}
Export-ModuleMember -Function *
