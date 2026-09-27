param([ValidateSet('set','test','remove')][string]$Action = 'test',[Parameter(Mandatory)][string]$DataRoot)
$ErrorActionPreference = 'Stop'
$credentialFile = Join-Path $DataRoot 'tunnel-runtime.dpapi'
switch ($Action) {
  'set' {
    if (Test-Path -LiteralPath $credentialFile) { throw '凭证已存在；请显式 remove 后重新设置，不覆盖未知值。' }
    $secret = Read-Host '输入 Tunnel Runtime Key（不回显）' -AsSecureString
    if ($secret.Length -lt 10) { throw '凭证长度不足' }
    $protected = ConvertFrom-SecureString $secret
    [System.IO.File]::WriteAllText($credentialFile,$protected)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [System.Security.AccessControl.FileSecurity]::new()
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true,$false)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','Allow'))
    Set-Acl -LiteralPath $credentialFile -AclObject $acl
    Write-Output '已保存当前 Windows 用户绑定的 DPAPI 凭证。'
  }
  'test' {
    if (!(Test-Path -LiteralPath $credentialFile)) { Write-Output 'CREDENTIAL_MISSING'; exit 1 }
    $secure = ConvertTo-SecureString (Get-Content -LiteralPath $credentialFile -Raw)
    if ($secure.Length -lt 10) { throw 'CREDENTIAL_INVALID' }
    Write-Output 'CREDENTIAL_AVAILABLE'
  }
  'remove' { if (Test-Path -LiteralPath $credentialFile) { Remove-Item -LiteralPath $credentialFile }; Write-Output '本地凭证已移除；平台撤销需在 Platform 完成。' }
}
