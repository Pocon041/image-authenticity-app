param(
  [Parameter(Mandatory=$true)][string]$SourceDirectory,
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [switch]$ExtractOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -TypeDefinition @'
using System;
using System.IO;
namespace SrdpOffline {
  public sealed class PartStream : Stream {
    private FileStream[] streams;
    private long[] offsets;
    private long length;
    private long position;
    public PartStream(string[] paths) {
      streams = new FileStream[paths.Length];
      offsets = new long[paths.Length];
      try {
        for (int i = 0; i < paths.Length; i++) {
          offsets[i] = length;
          streams[i] = new FileStream(paths[i], FileMode.Open, FileAccess.Read, FileShare.Read);
          length = checked(length + streams[i].Length);
        }
      } catch { Dispose(); throw; }
    }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return true; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return length; } }
    public override long Position { get { return position; } set { Seek(value, SeekOrigin.Begin); } }
    public override int Read(byte[] buffer, int offset, int count) {
      if (buffer == null) throw new ArgumentNullException("buffer");
      if (offset < 0 || count < 0 || offset > buffer.Length - count) throw new ArgumentOutOfRangeException();
      int total = 0;
      while (count > 0 && position < length) {
        int index = Array.BinarySearch(offsets, position);
        if (index < 0) index = ~index - 1;
        FileStream stream = streams[index];
        stream.Position = position - offsets[index];
        int requested = (int)Math.Min((long)count, stream.Length - stream.Position);
        int read = stream.Read(buffer, offset, requested);
        if (read == 0) throw new EndOfStreamException("Offline data part was truncated.");
        total += read; offset += read; count -= read; position += read;
      }
      return total;
    }
    public override long Seek(long offset, SeekOrigin origin) {
      long next = checked((origin == SeekOrigin.Begin ? 0 : origin == SeekOrigin.Current ? position : length) + offset);
      if (next < 0) throw new IOException("Invalid archive position.");
      position = next; return position;
    }
    public override void Flush() { }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    protected override void Dispose(bool disposing) {
      if (disposing && streams != null) foreach (FileStream stream in streams) if (stream != null) stream.Dispose();
      base.Dispose(disposing);
    }
  }
}
'@

try {
  $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.parts.Count -lt 1 -or $manifest.parts.Count -gt 100 -or $manifest.archiveSha256 -notmatch '^[a-f0-9]{64}$') {
    throw '安装数据清单无效。'
  }
  $sourceRoot = [IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\')
  $targetRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
  $marker = Join-Path $targetRoot '.srdp-offline-source.json'
  if (Test-Path -LiteralPath $targetRoot) {
    if (Test-Path -LiteralPath $marker) {
      $previous = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($previous.archiveSha256 -ne $manifest.archiveSha256) { throw '该目录属于其他版本，请选择新的空目录。' }
    } elseif (Get-ChildItem -LiteralPath $targetRoot -Force | Select-Object -First 1) {
      throw '请选择空目录保存离线安装资源，避免覆盖已有文件。'
    }
  }
  $paths = @()
  foreach ($part in $manifest.parts) {
    if ($part.name -ne [IO.Path]::GetFileName($part.name) -or $part.sha256 -notmatch '^[a-f0-9]{64}$' -or $part.bytes -le 0) { throw '安装数据分卷清单无效。' }
    $path = [IO.Path]::GetFullPath((Join-Path $sourceRoot $part.name))
    if (-not $path.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '数据路径无效。' }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "缺少数据文件 $($part.name)。请将完整安装器与全部数据分卷放在同一文件夹。" }
    if ((Get-Item -LiteralPath $path).Length -ne $part.bytes) { throw "数据文件大小不正确 $($part.name)。请重新下载该分卷。" }
    $paths += $path
  }
  $parts = New-Object SrdpOffline.PartStream -ArgumentList (,[string[]]$paths)
  try {
    for ($index = 0; $index -lt $manifest.parts.Count; $index++) {
      $part = $manifest.parts[$index]
      Write-Output "校验离线数据 $($index + 1)/$($manifest.parts.Count)　$($part.name)"
      $algorithm = [Security.Cryptography.SHA256]::Create()
      $hashStream = [IO.File]::Open($paths[$index], [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($hashStream)).Replace('-', '').ToLowerInvariant() }
      finally { $hashStream.Dispose(); $algorithm.Dispose() }
      if ($hash -ne $part.sha256) { throw "数据文件校验失败 $($part.name)。请重新下载该分卷。" }
    }
    $archive = New-Object IO.Compression.ZipArchive -ArgumentList $parts,([IO.Compression.ZipArchiveMode]::Read),$true
    try {
      $total = 0L
      $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
      foreach ($entry in $archive.Entries) {
        $path = [IO.Path]::GetFullPath((Join-Path $targetRoot $entry.FullName.Replace('/', '\')))
        if ([IO.Path]::IsPathRooted($entry.FullName) -or -not $path.StartsWith($targetRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($path)) { throw '安装资源包含无效或重复路径。' }
        $total += $entry.Length
      }
      if ($total -ne $manifest.expandedBytes) { throw '安装资源大小校验失败。' }
      [IO.Directory]::CreateDirectory($targetRoot) | Out-Null
      $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $marker -Encoding UTF8
      $index = 0
      foreach ($entry in $archive.Entries) {
        $index++
        Write-Output "准备安装资源 $index/$($archive.Entries.Count)　$($entry.FullName)"
        $path = [IO.Path]::GetFullPath((Join-Path $targetRoot $entry.FullName.Replace('/', '\')))
        if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($path) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
        $inputStream = $entry.Open()
        try {
          $outputStream = [IO.File]::Open($path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
          try { $inputStream.CopyTo($outputStream, 8 * 1024 * 1024) } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
      }
    } finally { $archive.Dispose() }
  } finally { $parts.Dispose() }
  if ($manifest.installer -ne [IO.Path]::GetFileName($manifest.installer)) { throw '应用安装器路径无效。' }
  $installer = Join-Path $targetRoot $manifest.installer
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw '应用安装器缺失。' }
  if (-not $ExtractOnly) {
    Write-Output '运行应用安装向导'
    $process = Start-Process -FilePath $installer -WorkingDirectory $targetRoot -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "应用安装已中止（$($process.ExitCode)）。可重新运行完整安装器继续。" }
  }
  Write-Output '离线安装资源已准备完成。'
  exit 0
} catch {
  Write-Output "安装准备失败：$($_.Exception.Message)"
  exit 1
}
