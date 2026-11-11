import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AppError } from "./errors";

export const desktopReleasePath = () =>
  path.resolve(process.cwd(), "public/downloads/desktop-windows.json");

export function windowsInstallerAvailable() {
  return existsSync(desktopReleasePath());
}

const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function renderWindowsInstaller(input: {
  server: string;
  code: string;
  workspaceId: string;
  sha256: string;
  bundle: string;
}) {
  const server = new URL(input.server);
  if (
    server.username ||
    server.password ||
    (server.protocol !== "https:" &&
      !(
        server.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(server.hostname)
      ))
  )
    throw new Error("Invalid installation server");
  z.string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .parse(input.code);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(input.sha256);
  z.string()
    .regex(/^desktop-windows-[a-f0-9]{16}\.zip$/)
    .parse(input.bundle);
  // The CMD wrapper reads its own PowerShell body, avoiding CMD's 8191-character limit.
  return String.raw`@echo off
set "NHIPDANG_INSTALLER=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$text = Get-Content -LiteralPath $env:NHIPDANG_INSTALLER -Raw; & ([scriptblock]::Create(($text -split '(?m)^# BEGIN INSTALLER\r?$', 2)[1]))"
if not errorlevel 1 exit /b 0
pause
exit /b 1
# BEGIN INSTALLER
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$server = ${psQuote(server.origin)}
$code = ${psQuote(input.code)}
$workspace = ${psQuote(input.workspaceId)}
$expectedHash = '${input.sha256}'
$bundleUrl = $server + '/downloads/${input.bundle}'
$appRoot = Join-Path $env:LOCALAPPDATA 'NhipDang'
$dataRoot = Join-Path $appRoot 'data'
$configPath = Join-Path $dataRoot 'connection.json'
$stage = Join-Path $appRoot ('.install-' + [guid]::NewGuid().ToString('N'))
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'NhipDang.vbs'
$unicode = [Text.Encoding]::Unicode
try {
  if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'Bo cai nay danh cho Windows 10/11 x64.'
  }
  New-Item -ItemType Directory -Path $stage, $appRoot, $dataRoot -Force | Out-Null
  $saved = $null
  if (Test-Path -LiteralPath $configPath) {
    $saved = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($saved.server -ne $server -or $saved.workspaceId -ne $workspace) {
      throw 'May nay da cai Nhip Dang cho tai khoan web khac. Hay dung dung tai khoan de cap nhat.'
    }
  }
  Write-Host 'Dang tai ung dung Nhip Dang. Ban chi can cai mot lan...'
  $zip = Join-Path $stage 'desktop.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $bundleUrl -OutFile $zip
  $sha = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($zip)
  try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
  if ($actualHash -ne $expectedHash) {
    throw 'Bo cai tai ve khong toan ven. Hay tai lai tu website.'
  }
  $release = Join-Path $appRoot '${input.sha256.slice(0, 16)}'
  if (-not (Test-Path -LiteralPath $release)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $unpacked = Join-Path $stage 'release'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpacked)
    for ($moveAttempt = 0; ; $moveAttempt++) {
      try { [IO.Directory]::Move($unpacked, $release); break }
      catch [IO.IOException], [UnauthorizedAccessException] {
        if ($moveAttempt -ge 5) { throw }
        Start-Sleep -Milliseconds 1000
      }
    }
  }
  $node = Join-Path $release 'node.exe'
  $env:NHIPDANG_DESKTOP_DIR = $dataRoot
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $appRoot 'browsers'
  $env:DOTENV_CONFIG_PATH = Join-Path $appRoot 'unused.env'
  $edge = @(
    (Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ }
  if (-not $edge) {
    Write-Host 'Dang cai trinh duyet cho Facebook...'
    & $node (Join-Path $release 'node_modules\playwright\cli.js') install chromium
    if ($LASTEXITCODE -ne 0) { throw 'Chua cai duoc trinh duyet. Hay kiem tra mang va thu lai.' }
  }
  if ($saved) {
    try {
      Invoke-RestMethod -Uri ($server + '/api/desktop/status') -Headers @{ Authorization = ('Bearer ' + $saved.token) } | Out-Null
    } catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $saved = $null }
      else { throw 'Chua kiem tra duoc ket noi cu. Hay kiem tra mang va thu lai.' }
    }
  }
  if (-not $saved) {
    Write-Host 'Dang ket noi voi website...'
    & $node (Join-Path $release 'desktop.mjs') --server $server --code $code --name ($env:COMPUTERNAME + ' (ung dung nen)') --pair-only
    if ($LASTEXITCODE -ne 0) { throw 'Chua ket noi duoc. Hay tai bo cai moi tu website va thu lai.' }
  }
  $launchPath = Join-Path $appRoot 'Start.vbs'
  $nodeCommand = '"' + $node + '" "' + (Join-Path $release 'background.mjs') + '"'
  $vbs = 'CreateObject("WScript.Shell").Run "' + $nodeCommand.Replace('"', '""') + '", 0, False'
  [IO.File]::WriteAllText($launchPath, $vbs, $unicode)
  $startupVbs = 'CreateObject("WScript.Shell").Run "wscript.exe ""' + $launchPath.Replace('"', '""') + '""", 0, False'
  [IO.File]::WriteAllText($startup, $startupVbs, $unicode)
  $protocol = 'HKCU:\Software\Classes\nhipdang'
  New-Item -Path ($protocol + '\shell\open\command') -Force | Out-Null
  Set-Item -Path $protocol -Value 'URL:Nhip Dang'
  New-ItemProperty -Path $protocol -Name 'URL Protocol' -Value '' -Force | Out-Null
  Set-Item -Path ($protocol + '\shell\open\command') -Value ('wscript.exe "' + $launchPath + '"')
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Nhip Dang'
  New-Item -ItemType Directory -Path $menu -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $webShortcut = $shell.CreateShortcut((Join-Path $menu 'Mo website.lnk'))
  $webShortcut.TargetPath = $server + '/desktop'
  $webShortcut.Save()
  $removeShortcut = $shell.CreateShortcut((Join-Path $menu 'Go cai dat.lnk'))
  $removeShortcut.TargetPath = 'powershell.exe'
  $removeShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $release 'uninstall.ps1') + '"'
  $removeShortcut.Save()
  $stopFile = Join-Path $dataRoot 'background.stop'
  if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
  Write-Host 'Da cai xong. Ung dung tu chay khi dang nhap Windows.'
  Write-Host 'Tu nay ban mo Facebook, tam dung va tiep tuc ngay tren website.'
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $launchPath + '"') -WindowStyle Hidden
  Start-Process ($server + '/desktop')
} catch {
  Write-Host ('Cai dat chua hoan tat: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  $appPrefix = [IO.Path]::GetFullPath($appRoot).TrimEnd('\') + '\'
  if ([IO.Path]::GetFullPath($stage).StartsWith($appPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $stage)) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
}
`.replaceAll("\n", "\r\n");
}

export async function desktopRelease() {
  try {
    const manifest = JSON.parse(await readFile(desktopReleasePath(), "utf8"));
    return z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bundle: z.string().regex(/^desktop-windows-[a-f0-9]{16}\.zip$/),
      })
      .parse(manifest);
  } catch {
    throw new AppError(
      503,
      "Bộ cài Windows chưa sẵn sàng. Vui lòng liên hệ quản trị viên.",
    );
  }
}
