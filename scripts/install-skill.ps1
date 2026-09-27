param([switch]$Update,[string]$SkillsRoot)
$relayArgs = @('skill','install')
if ($Update) { $relayArgs += '--update' }
if ($SkillsRoot) { $relayArgs += @('--skills-root',$SkillsRoot) }
& (Join-Path $PSScriptRoot 'relay.ps1') @relayArgs
exit $LASTEXITCODE
