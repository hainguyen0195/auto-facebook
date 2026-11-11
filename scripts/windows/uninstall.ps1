$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'NhipDang.vbs'
$protocol = 'HKCU:\Software\Classes\nhipdang'
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Nhip Dang'
Write-Host 'Dang tat ung dung nen Nhip Dang...'
[IO.File]::WriteAllText((Join-Path $appRoot 'data\background.stop'), 'stop')
if (Test-Path -LiteralPath $startup) {
  if ((Get-Content -LiteralPath $startup -Raw).Contains($appRoot)) {
    Remove-Item -LiteralPath $startup
  }
}
if (Test-Path -LiteralPath ($protocol + '\shell\open\command')) {
  $command = (Get-Item -LiteralPath ($protocol + '\shell\open\command')).GetValue('')
  if ($command.Contains($appRoot)) { Remove-Item -LiteralPath $protocol -Recurse }
}
foreach ($name in @('Mo website.lnk', 'Go cai dat.lnk')) {
  $shortcut = Join-Path $menu $name
  if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
}
Write-Host 'Da tat tu khoi dong va go lien ket website. Phien Facebook duoc giu tren may.'
Write-Host 'Du lieu nam trong: ' $appRoot
Read-Host 'Nhan Enter de dong'
