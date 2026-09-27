$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\runtime.json') -Raw | ConvertFrom-Json
if ($settings.product -ne 'mutou-relay' -or $settings.schema_version -ne 1) { throw 'Runtime 配置无效' }
& (Join-Path $settings.runtime_root 'scripts\relay.ps1') @args
exit $LASTEXITCODE
