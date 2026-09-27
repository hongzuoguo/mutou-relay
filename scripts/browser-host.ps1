param([Parameter(Mandatory)][string]$Session,[Parameter(Mandatory)][string]$CodeFile)
$ErrorActionPreference = 'Stop'
& playwright-cli '--raw' "-s=$Session" 'run-code' "--filename=$CodeFile"
exit $LASTEXITCODE
