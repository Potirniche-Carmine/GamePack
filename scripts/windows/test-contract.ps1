[CmdletBinding()]
param([Parameter(Mandatory)][string]$CoreExecutable)
$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('gamepack-windows-contract-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$library = Join-Path $temporary 'library'
function Request($Value, [bool]$ExpectedSuccess = $true) {
    $request = ConvertTo-Json -InputObject $Value -Depth 20 -Compress
    $response = $request | & $CoreExecutable $library | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $response.ok -ne $ExpectedSuccess) { throw "Windows/Rust drawing contract mismatch: $($response | ConvertTo-Json -Compress -Depth 20)" }
    return $response.data
}
try {
    $boot = Request @{command='bootstrap'}
    $source = Join-Path $temporary 'original.mp4'
    [IO.File]::WriteAllBytes($source, [byte[]](1,2,3,4,5))
    $originalHash = (Get-FileHash $source).Hash
    $video = Request @{command='import_video'; path=$source; project_id=$boot.projects[0].id; duration_us=2000000; width=1920; height=1080}
    foreach ($tool in @('pen','arrow','ellipse')) {
        $first = @{x=100000; y=200000; t_us=0}
        $last = @{x=800000; y=700000; t_us=100000}
        $drawing = @{id=[guid]::NewGuid().ToString(); tool=$tool; color='#FF775E'; width=3500; visible_from_us=0; visible_until_us=1000000; samples=@($first,$last)}
        $draft = @{id="windows-$tool"; project_id=$boot.projects[0].id; video_id=$video.id; text=''; anchor=@{kind='interval'; start_us=100000; end_us=1100000}; drawings=@($drawing)}
        $saved = Request @{command='save_draft'; draft=$draft}
        # A tap duplicates its single endpoint for arrow/ellipse; both must remain valid.
        $drawing.samples=@($first,$first)
        $null = Request @{command='save_draft'; draft=$draft}
        # Regression fixtures for the two payloads the original Windows host emitted.
        $drawing.id='{'+[guid]::NewGuid().ToString()+'}'
        $null = Request @{command='save_draft'; draft=$draft} $false
        $drawing.id=[guid]::NewGuid().ToString()
        if ($tool -ne 'pen') {
            $drawing.samples=@($first,$first,$last)
            $null = Request @{command='save_draft'; draft=$draft} $false
        }
    }
    if ((Get-FileHash $source).Hash -ne $originalHash) { throw 'Native drawing contract test altered the original source.' }
    Write-Host 'Windows/Rust contract fixtures passed: UUIDs, shape endpoints, single-point gestures, invalid legacy payloads, source preservation.'
} finally { if (Test-Path $temporary) { Remove-Item $temporary -Recurse -Force } }
