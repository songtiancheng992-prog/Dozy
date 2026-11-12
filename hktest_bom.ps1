$ErrorActionPreference = 'Stop'
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
$exe = 'D:\懒羊羊\懒羊羊.exe'
$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 3
Shot 'hk-a-start'
$sh = New-Object -ComObject WScript.Shell
$sh.SendKeys('^5')
Start-Sleep -Milliseconds 1500
Shot 'hk-b-ctrl5'
$sh.SendKeys('^1')
Start-Sleep -Milliseconds 1500
Shot 'hk-c-ctrl1'
Stop-Process -Id $p.Id -Force
Start-Sleep -Seconds 1
Write-Output 'HK_TEST_DONE'