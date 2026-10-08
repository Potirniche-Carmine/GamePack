function Assert-PeArchitecture([string]$Path, [string]$ExpectedArchitecture) {
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($Path))
    try {
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw "Not a Windows executable: $Path" }
        $reader.BaseStream.Position = 0x3c
        $peOffset = $reader.ReadUInt32()
        if ($peOffset -gt $reader.BaseStream.Length - 6) { throw "Invalid PE header: $Path" }
        $reader.BaseStream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Missing PE signature: $Path" }
        $expected = if ($ExpectedArchitecture -eq 'arm64') { 0xaa64 } else { 0x8664 }
        $actual = $reader.ReadUInt16()
        if ($actual -ne $expected) { throw ("Incorrect CPU architecture for {0}: machine 0x{1:x4}, expected 0x{2:x4}" -f $Path,$actual,$expected) }
    } finally { $reader.Dispose() }
}
function Resolve-LayoutPath([string]$Directory, [string]$Relative) {
    if (-not $Relative) { throw 'The package declares an empty executable or registration path.' }
    $root = [IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $path = [IO.Path]::GetFullPath((Join-Path $root $Relative.Replace('\', [string][IO.Path]::DirectorySeparatorChar)))
    if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw "Package path escapes its layout: $Relative" }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package declares a missing file: $Relative" }
    return $path
}
function Initialize-DevelopmentLayout([string]$Directory, [string]$Architecture) {
    [xml]$document = Get-Content -LiteralPath (Join-Path $Directory 'AppxManifest.xml') -Raw
    if ($document.Package.Identity.ProcessorArchitecture -ne $Architecture) { throw 'Package manifest CPU architecture does not match its release target.' }
    $desktop = @($document.Package.Dependencies.TargetDeviceFamily | Where-Object { $_.Name -eq 'Windows.Desktop' })
    if ($desktop.Count -ne 1 -or [version]$desktop[0].MinVersion -ne [version]'10.0.19041.0') {
        throw 'The generated package must declare Windows.Desktop MinVersion 10.0.19041.0.'
    }
    $executable = Resolve-LayoutPath $Directory $document.Package.Applications.Application.Executable
    $servers = @($document.SelectNodes('//*[local-name()="InProcessServer"]'))
    $registered = @($servers | ForEach-Object { Resolve-LayoutPath $Directory ([string]$_.Path) })
    $duplicate = Join-Path $Directory 'Microsoft.Web.WebView2.Core.dll'
    if (Test-Path -LiteralPath $duplicate) {
        $sibling = Join-Path (Split-Path $executable -Parent) 'Microsoft.Web.WebView2.Core.dll'
        $webView = @($servers | Where-Object {
            (Resolve-LayoutPath $Directory ([string]$_.Path)) -eq $sibling -and
            @($_.ActivatableClass | Where-Object { $_.ActivatableClassId -like 'Microsoft.Web.WebView2.Core.*' }).Count -gt 0
        })
        # RNW's WAP imports copy an extra x64 DLL to the package root. The
        # manifest and executable use the architecture-correct child copy.
        # Remove only that known redundant file, never a registered path.
        if ($duplicate -eq $sibling -or $registered -contains $duplicate -or -not $webView.Count) {
            throw 'Unexpected WebView layout: the root DLL is not proven to be an unused duplicate.'
        }
        Assert-PeArchitecture $duplicate 'x64'
        Assert-PeArchitecture $sibling $Architecture
        if ((Test-Path (Join-Path $Directory 'AppxBlockMap.xml')) -or (Test-Path (Join-Path $Directory 'AppxSignature.p7x'))) {
            throw 'Cannot filter a signed or block-mapped layout; rebuild the loose development layout.'
        }
        Remove-Item -LiteralPath $duplicate
    }
    # Check every supplied PE and every manifest activation target, including
    # Hermes and WebView, rather than assuming the app identity proves CPU type.
    foreach ($path in $registered) { Assert-PeArchitecture $path $Architecture }
    $native = @(Get-ChildItem $Directory -Recurse -File -Force | Where-Object { $_.Extension -in '.dll', '.exe' })
    if (-not $native.Count) { throw 'The development layout has no native executable.' }
    foreach ($file in $native) { Assert-PeArchitecture $file.FullName $Architecture }
    return $native.Count
}
