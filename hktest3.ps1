$ErrorActionPreference = 'Continue'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
function WinInfo($targetPid) {
  $sb = New-Object System.Text.StringBuilder 256
  $found = @()
  $cb = [W+EnumProc]{
    param($h, $l)
    $p = 0
    [W]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
    if ($p -eq $targetPid) {
      $r = New-Object W+RECT
      [W]::GetWindowRect($h, [ref]$r) | Out-Null
      $vis = [W]::IsWindowVisible($h)
      $ex = [W]::GetWindowLong($h, -20)
      $top = ($ex -band 0x8) -ne 0
      [W]::GetWindowText($h, $sb, 256) | Out-Null
      $script:found += ("hwnd=$h vis=$vis top=$top rect=$($r.L),$($r.T),$($r.R),$($r.B) title=$($sb.ToString())")
    }
    return $true
  }
  [W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  if ($found.Count -eq 0) { Write-Output "  (no windows)" } else { $found | ForEach-Object { Write-Output "  $_" } }
}
Get-Process | Where-Object { $_.Path -and $_.Path -like '*懒羊羊*' } | ForEach-Object { Stop-Process -Id $_.Id -Force }
Start-Sleep -Seconds 1
$p = Start-Process -FilePath 'D:\懒羊羊\懒羊羊.exe' -PassThru
Start-Sleep -Seconds 3
Write-Output ("alive=" + (-not $p.HasExited) + " pid=" + $p.Id)
Write-Output '--- at start ---'
WinInfo $p.Id
$sh = New-Object -ComObject WScript.Shell
$sh.SendKeys('^5')
Start-Sleep -Milliseconds 1200
Write-Output '--- after Ctrl+5 ---'
WinInfo $p.Id
$sh.SendKeys('^1')
Start-Sleep -Milliseconds 1200
Write-Output '--- after Ctrl+1 ---'
WinInfo $p.Id
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Write-Output 'HK3_DONE'