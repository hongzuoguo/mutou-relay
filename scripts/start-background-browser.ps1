param(
 [Parameter(Mandatory)][string]$Artifacts,
 [Parameter(Mandatory)][string]$Profile,
 [string]$Session='mutou-relay'
)
$ErrorActionPreference='Stop'
if ($Session -notmatch '^[a-zA-Z0-9_-]{1,60}$') { throw 'SESSION_INVALID' }
foreach ($p in @($Artifacts,$Profile)) { if (![IO.Path]::IsPathFullyQualified($p) -or $p.Contains('"')) { throw 'PATH_INVALID' } }
$node = (Get-Command node -ErrorAction Stop).Source
$cli = Join-Path (Split-Path (Get-Command playwright-cli -ErrorAction Stop).Source) 'node_modules\@playwright\cli\playwright-cli.js'
if (!(Test-Path -LiteralPath $cli)) { throw 'PLAYWRIGHT_CLI_NOT_FOUND' }
# Standard browser on an unselected Windows desktop; no fingerprint or challenge manipulation.
# https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createdesktopw
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class RelayDesktop {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
  public uint cb; public string reserved,desktop,title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
  public ushort show,reservedSize; public IntPtr reservedPtr,input,output,error;
 }
 [StructLayout(LayoutKind.Sequential)] struct Proc { public IntPtr process,thread; public uint pid,tid; }
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktop(string n,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr security);
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags,bool inherit,uint access);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr obj,int index,StringBuilder data,uint size,out uint needed);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup start,out Proc proc);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr obj,uint ms);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr obj);
 static string InputName() {
  var h=OpenInputDesktop(0,false,1); if(h==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
  try { var b=new StringBuilder(256);uint n;if(!GetUserObjectInformation(h,2,b,512,out n))throw new Win32Exception(Marshal.GetLastWin32Error());return b.ToString(); }
  finally {CloseDesktop(h);}
 }
 public static string Launch(string node,string command,string cwd,string name) {
  string before=InputName();var desk=CreateDesktop(name,IntPtr.Zero,IntPtr.Zero,0,0x1FF,IntPtr.Zero);
  if(desk==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
  try {
   var start=new Startup();start.cb=(uint)Marshal.SizeOf(start);start.desktop="winsta0\\"+name;Proc proc;
   if(!CreateProcess(node,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x08000000,IntPtr.Zero,cwd,ref start,out proc))throw new Win32Exception(Marshal.GetLastWin32Error());
   try {
    if(WaitForSingleObject(proc.process,30000)!=0)throw new Exception("BACKGROUND_BROWSER_START_TIMEOUT");
    uint code;if(!GetExitCodeProcess(proc.process,out code)||code!=0)throw new Exception("BACKGROUND_BROWSER_START_FAILED:"+code);
    if(InputName()!=before)throw new Exception("INPUT_DESKTOP_CHANGED");
    return before;
   }finally{CloseHandle(proc.thread);CloseHandle(proc.process);}
  }finally{CloseDesktop(desk);}
 }
}
'@
$desktopName='MutouRelay_'+[guid]::NewGuid().ToString('N')
$command='"'+$node+'" "'+$cli+'" --raw -s='+$Session+' open about:blank --browser=msedge --headed --profile="'+$Profile+'"'
$inputDesktop=[RelayDesktop]::Launch($node,$command,$Artifacts,$desktopName)
[pscustomobject]@{mode='background-desktop';desktop=$desktopName;input_desktop=$inputDesktop;input_desktop_unchanged=$true;session=$Session} | ConvertTo-Json -Compress
