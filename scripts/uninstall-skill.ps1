param([string]$SkillsRoot)
$relayArgs = @('skill','uninstall')
if ($SkillsRoot) { $relayArgs += @('--skills-root',$SkillsRoot) }
& (Join-Path $PSScriptRoot 'relay.ps1') @relayArgs
exit $LASTEXITCODE
