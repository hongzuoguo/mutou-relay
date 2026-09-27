param([Parameter(Mandatory)][string]$Path,[ValidateSet('set','remove')][string]$Action='set')
$ErrorActionPreference='Stop'
# Owned test fixture only. No driver is installed and no target path is encoded.
# https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-reparse_guid_data_buffer
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class FixtureReparse {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFile(string p,uint a,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool DeviceIoControl(SafeFileHandle h,uint code,byte[] input,int length,IntPtr output,int size,out uint returned,IntPtr overlap);
 public static void Apply(string path,bool remove) {
  using(var h=CreateFile(path,0xC0000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
   if(h.IsInvalid)throw new Win32Exception(Marshal.GetLastWin32Error());
   var buffer=new byte[24]; Array.Copy(BitConverter.GetBytes((uint)0x20000042),buffer,4);
   Array.Copy(new Guid("43bcfe45-4adf-499c-b31b-9ea228daaf83").ToByteArray(),0,buffer,8,16);
   uint returned;
   if(!DeviceIoControl(h,remove?0x000900ACu:0x000900A4u,buffer,buffer.Length,IntPtr.Zero,0,out returned,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
  }
 }
}
'@
[FixtureReparse]::Apply($Path,($Action -eq 'remove'))
Write-Output 'OK'
