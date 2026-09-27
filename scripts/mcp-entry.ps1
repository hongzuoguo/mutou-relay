param([Parameter(Mandatory)][string]$DataRoot,[Parameter(Mandatory)][string]$Node,[Parameter(Mandatory)][string]$Entry,[string]$Instance)
$ErrorActionPreference = 'Stop'
# Clear all inherited secrets before creating the Node MCP process.
$keep = @('SYSTEMROOT','WINDIR','PATH','PATHEXT','TEMP','TMP','LOCALAPPDATA','USERPROFILE','APPDATA','COMSPEC','NUMBER_OF_PROCESSORS')
Get-ChildItem Env: | Where-Object { $_.Name.ToUpperInvariant() -notin $keep } | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$env:MUTOU_RELAY_HOME = $DataRoot
if ($Instance) { $env:MUTOU_RELAY_INSTANCE = $Instance }
& $Node $Entry 'mcp'
exit $LASTEXITCODE
