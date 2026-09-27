$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw '需要 PowerShell 7+' }
$entry = Join-Path $PSScriptRoot '..\dist\src\cli.js'
if (!(Test-Path -LiteralPath $entry)) { throw '请先在源码根目录运行 npm ci 和 npm run build' }
& node $entry @args
exit $LASTEXITCODE
