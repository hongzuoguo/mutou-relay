param([string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'MutouRelay'))
$ErrorActionPreference = 'Stop'
if (![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw '此安装器锁定已验证的 Windows amd64 发行版' }
$version = '0.0.15'
$expected = '3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1'
$target = Join-Path $DataRoot "bin\tunnel-client-v$version"
if (Test-Path -LiteralPath $target) { throw '目标已存在；请检查现有安装，拒绝覆盖未知文件。' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
$zip = Join-Path $target 'download.zip'
$url = "https://github.com/openai/tunnel-client/releases/download/v$version/tunnel-client-v$version-windows-amd64.zip"
Invoke-WebRequest -Uri $url -OutFile $zip
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw '官方发行包 SHA256 不匹配；未执行或解压。' }
Expand-Archive -LiteralPath $zip -DestinationPath $target
$exe = Join-Path $target 'tunnel-client.exe'
$manifest = @{ schema_version=1; version=$version; source=$url; zip_sha256=$expected; executable_sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant(); signature_verified=$false; checked_at=[DateTime]::UtcNow.ToString('o') }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'mutou-install.json') -Encoding utf8
& $exe --version
Remove-Item -LiteralPath $zip
