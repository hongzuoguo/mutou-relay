param([Parameter(Mandatory)][string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
# One-time acceptance helper: creates one link inside an existing harmless fixture.
# It does not enable Developer Mode, change security policy, or run project code.
$root = [IO.Path]::GetFullPath($FixtureRoot)
if ([IO.Path]::GetFileName($root) -notmatch '^mutou-symlink-[0-9a-f-]{36}$') { throw 'FIXTURE_NAME_INVALID' }
$current = $root
while ($current) {
  if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'FIXTURE_LINK_UNSAFE' }
  $parent = [IO.Directory]::GetParent($current)
  $current = if ($parent) { $parent.FullName } else { $null }
}
$marker = Join-Path $root 'fixture.json'
$spec = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
if ($spec.product -ne 'mutou-relay-symlink-acceptance' -or $spec.root -ne $root) { throw 'FIXTURE_IDENTITY_INVALID' }
$target = Join-Path $root 'outside.txt'
$project = Join-Path $root 'project'
$link = Join-Path $project 'symbolic.txt'
if ([IO.File]::ReadAllText($target) -ne 'Harmless symbolic-link acceptance fixture.') { throw 'FIXTURE_CONTENT_INVALID' }
if (([IO.File]::GetAttributes($project) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'FIXTURE_LINK_UNSAFE' }
if ([IO.Directory]::GetFileSystemEntries($project).Count -ne 0) { throw 'FIXTURE_PROJECT_NOT_EMPTY' }
[void][IO.File]::CreateSymbolicLink($link,$target)
Write-Output 'One fixture symlink created. No system settings changed.'
