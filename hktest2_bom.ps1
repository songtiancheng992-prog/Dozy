$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$dir = 'C:\Users\22535\.qwenworkcn\workspace\mve5hachsjz4vdu7'
function Shot($name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
  $bmp.Save("$dir\$name.png")
  $g.Dispose(); $bmp.Dispose()
}
Write-Output '--- existing instances ---'
Get-Process | Where-Object { $_.Path -like 'D:\*exe' -and $_.MainWindowTitle -ne $null } | ForEach-Object { Write-Output ("pid=" + $_.Id + " name=" + $_.ProcessName + " path=" + $_.Path) }
Get-Process | Where-Object { $_.ProcessName -match 'lazy|goat' -or ($_.Path -and $_.Path -like '*懒羊羊*') } | ForEach-Object { Write-Output ("FOUND pid=" + $_.Id + " name=" + $_.ProcessName); Stop-Process -Id $_.Id -Force }
Start-Sleep -Seconds 1
Write-Output '--- start fresh ---'
$p = Start-Process -FilePath 'D:\懒羊羊\懒羊羊.exe' -PassThru
Start-Sleep -Seconds 3
if ($p.HasExited) { Write-Output ('EXITED_EARLY code=' + $p.ExitCode) } else { Write-Output ('ALIVE pid=' + $p.Id) }
Shot 'hk2-a-start'
$sh = New-Object -ComObject WScript.Shell
$sh.SendKeys('^5')
Start-Sleep -Milliseconds 1500
Shot 'hk2-b-ctrl5'
$sh.SendKeys('^1')
Start-Sleep -Milliseconds 1500
Shot 'hk2-c-ctrl1'
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; Write-Output 'STOPPED_OK' } else { Write-Output 'ALREADY_EXITED' }
Write-Output 'HK2_DONE'