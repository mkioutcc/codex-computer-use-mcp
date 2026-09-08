param([string]$CommandPath, [string]$ArgumentsJson, [string]$WorkingDirectory, [uint32]$ParentPid)
$ErrorActionPreference = 'Stop'
# Own only the adapter's process tree, never the user's running Codex app.
# Create suspended, assign to a kill-on-close job, then resume: no child-spawn race.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class ComputerUseJob {
    [StructLayout(LayoutKind.Sequential)] struct StartupInfo {
        public int cb; public IntPtr reserved, desktop, title;
        public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
        public ushort show,reservedSize; public IntPtr reservedBytes,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long processTime,jobTime; public uint flags;
        public UIntPtr minWorkingSet,maxWorkingSet; public uint activeProcesses;
        public UIntPtr affinity; public uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit basic; public IoCounters io;
        public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimit info, uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo si, out ProcessInfo pi);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint timeout);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static string Quote(string text) {
        var b=new StringBuilder("\""); int slashes=0;
        foreach(char c in text) {
            if(c=='\\') { slashes++; continue; }
            b.Append('\\', c=='"' ? slashes*2+1 : slashes); b.Append(c); slashes=0;
        }
        b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
    }
    static void Check(bool success) { if(!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public static int Run(string app, string[] args, string cwd, uint parentPid) {
        IntPtr job=CreateJobObjectW(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
        var pi=new ProcessInfo(); IntPtr parent=IntPtr.Zero;
        try {
            parent=OpenProcess(0x100000,false,parentPid); Check(parent!=IntPtr.Zero);
            var limits=new ExtendedLimit(); limits.basic.flags=0x2000;
            Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit))));
            var si=new StartupInfo(); si.cb=Marshal.SizeOf(typeof(StartupInfo)); si.flags=0x100;
            si.input=GetStdHandle(-10); si.output=GetStdHandle(-11); si.error=GetStdHandle(-12);
            Check(SetHandleInformation(si.input,1,1)); Check(SetHandleInformation(si.output,1,1)); Check(SetHandleInformation(si.error,1,1));
            var command=new StringBuilder(Quote(app)); foreach(string arg in args) command.Append(" ").Append(Quote(arg));
            Check(CreateProcessW(app,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref si,out pi));
            Check(AssignProcessToJobObject(job,pi.process));
            if(ResumeThread(pi.thread)==0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error());
            uint wait=WaitForMultipleObjects(2,new IntPtr[]{pi.process,parent},false,0xffffffff);
            if(wait==1) return 1;
            if(wait!=0) throw new Win32Exception(Marshal.GetLastWin32Error());
            uint exitCode; Check(GetExitCodeProcess(pi.process,out exitCode)); return unchecked((int)exitCode);
        } finally {
            if(pi.process!=IntPtr.Zero) { TerminateProcess(pi.process,1); CloseHandle(pi.process); }
            if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
            if(parent!=IntPtr.Zero) CloseHandle(parent);
            CloseHandle(job);
        }
    }
}
'@
exit [ComputerUseJob]::Run($CommandPath, [string[]]($ArgumentsJson | ConvertFrom-Json), $WorkingDirectory, $ParentPid)
