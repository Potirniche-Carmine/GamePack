[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Prepare','Install')][string]$Mode, [Parameter(Mandatory)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'update-core.psm1') -Force -DisableNameChecking
$lock = $null; $statePath = $null; $request = $null; $committed = $false; $parentExited = $false; $ownsState = $false
function Set-UpdateState([string]$Status, [double]$Progress = -1, [string]$ErrorText = '') {
    $value = @{status=$Status; version=$request.version; transaction=$request.transaction; workerPid=$PID; workerStart=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()}
    if ($Progress -ge 0) { $value.progress = $Progress }
    if ($ErrorText) { $value.error = $ErrorText }
    Write-UpdateJson $statePath $value
}
function Assert-SingleInstance([bool]$AllowParent) {
    foreach ($process in @(Get-Process -Name GamePack -ErrorAction SilentlyContinue)) {
        try { $path = $process.Path } catch { continue }
        if ($path -and $path.Equals($request.executable, [StringComparison]::OrdinalIgnoreCase) -and (-not $AllowParent -or $process.Id -ne $request.parentPid)) { throw 'Close the other GamePack window before updating.' }
    }
}
function Start-RegisteredGamePack {
    $app = @(Get-AppxPackage -Name GamePack)
    if ($app.Count -ne 1 -or $app[0].Publisher -cne 'CN=GamePack') { throw 'GamePack could not be reopened. Open it from the Start menu.' }
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList "shell:AppsFolder\$($app[0].PackageFamilyName)!App" -ErrorAction Stop | Out-Null
}
try {
    $request = Read-UpdateJson $RequestFile
    if ($request.transaction -cnotmatch '^[a-f0-9]{32}$') { throw 'The update transaction is invalid.' }
    $cache = Join-Path ([IO.Path]::GetFullPath($request.dataRoot)) 'updates/windows'
    $transaction = Join-Path $cache $request.transaction
    if (-not ([IO.Path]::GetFullPath($RequestFile)).Equals((Join-Path $transaction 'request.json'), [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFullPath($PSScriptRoot)).Equals($transaction, [StringComparison]::OrdinalIgnoreCase)) { throw 'The update transaction is invalid.' }
    Assert-PlainPath $transaction
    $statePath = Join-Path $cache 'state.json'
    # A separate process cannot start another operation for the same library.
    $lock = [IO.File]::Open((Join-Path $cache 'operation.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $existingState = Read-UpdateJson $statePath
    if ($existingState.transaction -cne $request.transaction) { throw 'The update transaction changed. Try again.' }
    $ownsState = $true
    $version = Assert-NewerVersion $request.tag $request.currentVersion
    if ($version.ToString(3) -cne $request.version -or $request.architecture -notin @('x64','arm64')) { throw 'The update version is invalid.' }
    $installed = Assert-ManagedInstallation $request
    Assert-SingleInstance $true
    $parent = Get-ExactParentProcess $request
    $archive = Join-Path $transaction 'update.zip'
    $readyPath = Join-Path $transaction 'ready.json'
    if ($Mode -eq 'Prepare') {
        Set-UpdateState 'downloading' 0
        # The native caller returns as soon as this trusted worker has accepted preparation.
        Write-UpdateJson (Join-Path $transaction 'prepare-accepted.json') @{workerPid=$PID}
        $metadata = Join-Path $transaction 'release.json'
        Receive-UpdateFile ('https://api.github.com/repos/Potirniche-Carmine/GamePack/releases/tags/' + [Uri]::EscapeDataString($request.tag)) $metadata 1048576
        $release = Read-UpdateJson $metadata
        $selection = Get-ReleaseSelection $release $request.tag $request.architecture
        $digest = $selection.Digest
        if ($selection.Checksum) {
            $checksumPath = Join-Path $transaction 'update.sha256'
            Receive-UpdateFile ($selection.Url + '.sha256') $checksumPath 4096 ([long]$selection.Checksum.size)
            $checksum = Read-Checksum ([IO.File]::ReadAllText($checksumPath)) $selection.Name
            if ($digest -and $digest -ine $checksum) { throw 'The release checksums disagree. Try again later.' }
            $digest = $checksum
        }
        Receive-UpdateFile $selection.Url $archive 536870912 $selection.Size {param($value) Set-UpdateState 'downloading' $value}
        Set-UpdateState 'verifying'
        Assert-UpdateHash $archive $digest
        $extracted = Join-Path $transaction 'verified'
        Expand-UpdateArchive $archive $extracted
        $null = Test-UpdateLayout $extracted $request.architecture $version
        Write-UpdateJson $readyPath @{sha256=$digest; size=$selection.Size; version=$request.version; tag=$request.tag; architecture=$request.architecture}
        # Extract afresh at installation, so modifications to the first staging tree cannot be installed.
        Remove-Item -LiteralPath $extracted -Recurse -Force
        Set-UpdateState 'ready'
    } else {
        if ($existingState.status -cne 'installing') { throw 'Download the update again before restarting.' }
        $ready = Read-UpdateJson $readyPath
        if ($ready.version -cne $request.version -or $ready.tag -cne $request.tag -or $ready.architecture -cne $request.architecture -or (Get-Item -LiteralPath $archive).Length -ne $ready.size) { throw 'The prepared update changed. Download it again.' }
        Assert-UpdateHash $archive $ready.sha256
        $extracted = Join-Path $transaction ('install-' + [guid]::NewGuid().ToString('N'))
        Expand-UpdateArchive $archive $extracted
        $layout = Test-UpdateLayout $extracted $request.architecture $version
        $destination = Join-Path $request.dataRoot 'app/windows'
        $backup = Join-Path $request.dataRoot ('app/windows.previous-' + $request.transaction)
        Assert-PlainPath $destination; Assert-PlainPath $extracted
        # Validate the current registration again after potentially lengthy verification.
        $installed = Assert-ManagedInstallation $request
        Assert-SingleInstance $true
        if (Test-Path -LiteralPath (Join-Path $transaction 'cancel-install')) { throw 'The restart was cancelled. Try again.' }
        Set-UpdateState 'installing'
        Write-UpdateJson (Join-Path $transaction 'install-accepted.json') @{workerPid=$PID}
        Wait-UpdatePermission $transaction $PID
        if (-not $parent.WaitForExit(60000)) { throw 'GamePack could not close. Close it and try the update again.' }
        $parentExited = $true
        if (Test-Path -LiteralPath (Join-Path $transaction 'cancel-install')) { throw 'The restart was cancelled. Try again.' }
        Assert-SingleInstance $false
        $installed = Assert-ManagedInstallation $request
        foreach ($dependency in $layout.Dependencies) {
            $identity = $dependency.Identity
            $matching = @(Get-AppxPackage -Name $identity.Name | Where-Object { $_.Publisher -ceq $identity.Publisher -and [version]$_.Version -ge [version]$identity.Version -and $_.Architecture.ToString() -in @($request.architecture,'neutral') })
            if (-not $matching.Count) { Add-AppxPackage -Path $dependency.Path -ErrorAction Stop }
        }
        [IO.File]::WriteAllText((Join-Path ([IO.Path]::GetDirectoryName($layout.Executable)) 'gamepack-root.txt'), $request.dataRoot, [Text.UTF8Encoding]::new($false))
        $unregister = {
            foreach ($app in @(Get-AppxPackage -Name GamePack)) {
                if ($app.Publisher -cne 'CN=GamePack' -or -not ([IO.Path]::GetFullPath($app.InstallLocation)).Equals($destination, [StringComparison]::OrdinalIgnoreCase)) { throw 'The installed app changed. Restart GamePack and try again.' }
                Remove-AppxPackage -Package $app.PackageFullName -ErrorAction Stop
            }
        }
        $register = {param($manifest) Add-AppxPackage -Register $manifest -ErrorAction Stop}
        $verify = {
            $app = @(Get-AppxPackage -Name GamePack)
            if ($app.Count -ne 1 -or $app[0].Publisher -cne 'CN=GamePack' -or [version]$app[0].Version -ne $version -or -not ([IO.Path]::GetFullPath($app[0].InstallLocation)).Equals($destination, [StringComparison]::OrdinalIgnoreCase)) { throw 'Windows did not register the updated app.' }
        }
        Invoke-UpdateReplacement $destination $layout.Package $backup $unregister $register $verify
        $committed = $true
        Set-UpdateState 'idle'
        Start-RegisteredGamePack
        # Only application staging is removed. The database, drafts and media are never touched.
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $extracted -Recurse -Force -ErrorAction SilentlyContinue
    }
} catch {
    $detail = $_.Exception.Message
    if ($ownsState -and $request -and $statePath) {
        try {
            [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'error.log'), ($_ | Out-String), [Text.UTF8Encoding]::new($false))
            $message = if ($Mode -eq 'Prepare') { 'The update could not be downloaded or verified. Try again.' } elseif ($committed) { 'The update was installed. Open GamePack from the Start menu.' } else { 'The update could not be installed. Restart GamePack and try again.' }
            if ($detail -match '^(The update |The release checksums |The expanded update |The prepared update |This update |A valid update |An update dependency |Install GamePack |Developer Mode |Close the other |GamePack could not close|The installed app |The app process |Updates cannot use linked |Download the update again)' -and $detail.Length -le 250) { $message = $detail }
            Set-UpdateState 'error' -ErrorText $message
        } catch { }
    }
    # Never roll back after launch: a newer app could already have migrated its database.
    if ($parentExited -and -not $committed) { try { Start-RegisteredGamePack } catch { } }
    exit 1
} finally { if ($lock) { $lock.Dispose() } }
