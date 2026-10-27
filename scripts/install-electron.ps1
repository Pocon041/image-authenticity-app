param(
    [ValidateSet('x64', 'arm64', 'ia32')]
    [string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    $projectDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $electronDirectory = Join-Path $projectDirectory 'node_modules\electron'
    $package = Get-Content -LiteralPath (Join-Path $electronDirectory 'package.json') -Raw | ConvertFrom-Json
    $electronVersion = $package.version
    if ($electronVersion -notmatch '^\d+\.\d+\.\d+([-.][\w.-]+)?$') {
        throw 'Invalid Electron package version.'
    }

    $archiveName = "electron-v$electronVersion-win32-$Architecture.zip"
    $checksums = Get-Content -LiteralPath (Join-Path $electronDirectory 'checksums.json') -Raw | ConvertFrom-Json
    $checksumProperty = $checksums.PSObject.Properties[$archiveName]
    if (-not $checksumProperty -or $checksumProperty.Value -notmatch '^[a-fA-F0-9]{64}$') {
        throw 'The installed Electron package does not contain a valid SHA256 for this platform.'
    }
    $expectedHash = $checksumProperty.Value.ToLowerInvariant()
    $cacheDirectory = Join-Path $projectDirectory 'work\electron-cache'
    New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
    $archivePath = Join-Path $cacheDirectory $archiveName
    $cacheValid = (Test-Path -LiteralPath $archivePath) -and
        ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedHash)

    if (-not $cacheValid) {
        $downloadUrl = "https://github.com/electron/electron/releases/download/v$electronVersion/$archiveName"
        Write-Output "[runtime] Downloading the official Electron release: $archiveName"
        Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath -TimeoutSec 180
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
            throw 'Electron archive SHA256 mismatch. The downloaded archive will not be installed.'
        }
    } else {
        Write-Output '[runtime] Using the verified local archive.'
    }

    $distributionDirectory = Join-Path $electronDirectory 'dist'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $distributionDirectory -Force
    $installedVersion = (Get-Content -LiteralPath (Join-Path $distributionDirectory 'version') -Raw).Trim().TrimStart('v')
    if ($installedVersion -ne $electronVersion -or
        -not (Test-Path -LiteralPath (Join-Path $distributionDirectory 'electron.exe'))) {
        throw 'Extracted Electron runtime is incomplete or has the wrong version.'
    }
    # Write the discovery marker only after extraction and validation succeeded.
    [System.IO.File]::WriteAllText((Join-Path $electronDirectory 'path.txt'), 'electron.exe')
    Write-Output '[runtime] Electron installed and SHA256 verified.'
} catch {
    [Console]::Error.WriteLine('[runtime] ' + $_.Exception.Message)
    exit 1
}
