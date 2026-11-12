$ErrorActionPreference = 'Continue'
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W2 {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string List(uint target) {
    var sb = new StringBuilder();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == target) {
        RECT r; GetWindowRect(h, out r);
        bool vis = IsWindowVisible(h);
        int ex = GetWindowLong(h, -20);
        bool top = (ex & 0x8) != 0;
        var t = new StringBuilder(256); GetWindowText(h, t, 256);
        sb.AppendLine("  hwnd=" + h + " vis=" + vis + " top=" + top + " rect=" + r.L + "," + r.T + "," + r.R + "," + r.B + " title=" + t);
      }
      return true;
    }, IntPtr.Zero);
    return sb.Length == 0 ? "  (no windows)" : sb.ToString();
  }
}
"@
Get-Process | Where-Object { $_.Path -and $_.Path -like '*懒羊羊*' } | ForEach-Object { Stop-Process -Id $_.Id -Force }
Start-Sleep -Seconds 1
$p = Start-Process -FilePath 'D:\懒羊羊\懒羊羊.exe' -PassThru
Start-Sleep -Seconds 3
Write-Output ("alive=" + (-not $p.HasExited) + " pid=" + $p.Id + " mainhwnd=" + $p.MainWindowHandle + " title=" + $p.MainWindowTitle)
Write-Output '--- at start ---'
[W2]::List([uint32]$p.Id)
$sh = New-Object -ComObject WScript.Shell
$sh.SendKeys('^5')
Start-Sleep -Milliseconds 1200
Write-Output '--- after Ctrl+5 ---'
[W2]::List([uint32]$p.Id)
$sh.SendKeys('^1')
Start-Sleep -Milliseconds 1200
Write-Output '--- after Ctrl+1 ---'
[W2]::List([uint32]$p.Id)
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Write-Output 'HK4_DONE'