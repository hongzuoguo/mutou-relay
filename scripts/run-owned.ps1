param([Parameter(Mandatory)][string]$SpecPath)
$ErrorActionPreference = 'Stop'
# Own a Windows Job before creating the child: descendants die with this wrapper.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RelayJob {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr h,int c,IntPtr p,uint s);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr h,IntPtr p);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr c,d; public uint e; public UIntPtr f; public uint g,h; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public IO io; public UIntPtr a,b,c,d; }
 public static IntPtr Hold() {
  var job=CreateJobObject(IntPtr.Zero,null); var info=new Extended(); info.basic.flags=0x2000;
  int size=Marshal.SizeOf(info); var mem=Marshal.AllocHGlobal(size);
  try { Marshal.StructureToPtr(info,mem,false); if(job==IntPtr.Zero || !SetInformationJobObject(job,9,mem,(uint)size) || !AssignProcessToJobObject(job,GetCurrentProcess())) throw new Exception("WINDOWS_JOB_FAILED"); }
  finally { Marshal.FreeHGlobal(mem); } return job;
 }
}
'@
$relayJobHandle = [RelayJob]::Hold()
$spec = Get-Content -LiteralPath $SpecPath -Raw | ConvertFrom-Json
if ($spec.schema_version -ne 1) { throw 'SPEC_INVALID' }
$info = [System.Diagnostics.ProcessStartInfo]::new()
$info.FileName = $spec.executable
$info.WorkingDirectory = $spec.cwd
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
foreach ($argument in $spec.arguments) { [void]$info.ArgumentList.Add([string]$argument) }
if ($spec.credential_file) {
  $protected = Get-Content -LiteralPath $spec.credential_file -Raw
  $secure = ConvertTo-SecureString $protected
  $info.Environment['CONTROL_PLANE_API_KEY'] = [System.Net.NetworkCredential]::new('', $secure).Password
}
$child = [System.Diagnostics.Process]::Start($info)
$relayStdout = [Console]::OpenStandardOutput()
$relayStderr = [Console]::OpenStandardError()
$copyOut = $child.StandardOutput.BaseStream.CopyToAsync($relayStdout)
$copyErr = $child.StandardError.BaseStream.CopyToAsync($relayStderr)
$child.WaitForExit()
[void]$copyOut.GetAwaiter().GetResult()
[void]$copyErr.GetAwaiter().GetResult()
$relayStdout.Flush()
$relayStderr.Flush()
$result = $child.ExitCode
$info.Environment.Remove('CONTROL_PLANE_API_KEY') | Out-Null
exit $result
