# OMEGA PRIME PIN window: type a new site PIN twice and save. Replaces the console version, which closed on input.
# The PIN goes to web/scripts/pin-form-save.mjs on stdin; it is never shown, logged or passed as an argument.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$web = Join-Path $PSScriptRoot '..\web' | Resolve-Path

$form = New-Object System.Windows.Forms.Form
$form.Text = 'OMEGA PRIME - رمز الموقع'
$form.Size = New-Object System.Drawing.Size(560, 420)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.RightToLeft = 'Yes'
$form.RightToLeftLayout = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(17, 24, 39)
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font('Segoe UI', 11)

function Add-Label($text, $y, $size = 11, $bold = $false) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text; $l.AutoSize = $false; $l.Size = New-Object System.Drawing.Size(500, 28); $l.Location = New-Object System.Drawing.Point(20, $y)
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $l.Font = New-Object System.Drawing.Font('Segoe UI', $size, $style)
  $form.Controls.Add($l); $l
}
function Add-Box($y) {
  $b = New-Object System.Windows.Forms.TextBox
  $b.Location = New-Object System.Drawing.Point(20, $y); $b.Size = New-Object System.Drawing.Size(500, 32)
  $b.UseSystemPasswordChar = $true; $b.RightToLeft = 'No'
  $b.BackColor = [System.Drawing.Color]::FromArgb(26, 31, 53); $b.ForeColor = [System.Drawing.Color]::White
  $form.Controls.Add($b); $b
}

[void](Add-Label 'اكتب رمز جديد (6 إلى 12 رقم)، ومرة ثانية للتأكيد.' 15 12 $true)
[void](Add-Label 'الرمز الجديد' 60)
$p1 = Add-Box 90
[void](Add-Label 'اكتبه مرة ثانية' 135)
$p2 = Add-Box 165

$show = New-Object System.Windows.Forms.CheckBox
$show.Text = 'أظهر الأرقام'
$show.Location = New-Object System.Drawing.Point(20, 198); $show.Size = New-Object System.Drawing.Size(500, 20)
$show.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$show.Add_CheckedChanged({ $p1.UseSystemPasswordChar = -not $show.Checked; $p2.UseSystemPasswordChar = -not $show.Checked })
$form.Controls.Add($show)

$save = New-Object System.Windows.Forms.Button
$save.Text = 'احفظ الرمز'
$save.Location = New-Object System.Drawing.Point(20, 225); $save.Size = New-Object System.Drawing.Size(500, 48)
$save.BackColor = [System.Drawing.Color]::FromArgb(245, 179, 1); $save.ForeColor = [System.Drawing.Color]::FromArgb(10, 14, 26)
$save.FlatStyle = 'Flat'; $save.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($save)

$result = Add-Label '' 285 11
$result.Size = New-Object System.Drawing.Size(500, 80)
$red = [System.Drawing.Color]::FromArgb(239, 68, 68)

$save.Add_Click({
  if ($p1.Text.Trim() -ne $p2.Text.Trim()) { $result.ForeColor = $red; $result.Text = 'الرمزين مو نفس بعض. اكتبهم من جديد.'; return }
  $save.Enabled = $false; $result.ForeColor = [System.Drawing.Color]::White; $result.Text = 'جاري الحفظ...'; $form.Refresh()
  $payload = @{ pin = $p1.Text.Trim() } | ConvertTo-Json -Compress
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'node'; $psi.Arguments = 'scripts/pin-form-save.mjs'; $psi.WorkingDirectory = $web
  $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true; $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.Write($payload); $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd(); $p.WaitForExit(); $payload = $null
  if ($p.ExitCode -ne 0) {
    $msg = if ($out -match '6 to 12') { 'الرمز لازم يكون من 6 إلى 12 رقم.' } else { 'ما انحفظ. جرّب مرة ثانية.' }
    $result.ForeColor = $red; $result.Text = $msg; $save.Enabled = $true; return
  }
  $p1.Text = ''; $p2.Text = ''
  $c = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { Stop-Process -Id $c.OwningProcess -Force }
  Start-Process -FilePath node -ArgumentList 'scripts/secure-run.mjs','start','-p','3100','-H','127.0.0.1' -WorkingDirectory $web -WindowStyle Hidden
  $result.ForeColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
  $result.Text = 'تم! الرمز الجديد محفوظ ومشفّر. الموقع يعيد التشغيل، وبعد 10 ثواني استخدم الرمز الجديد.'
  $save.Enabled = $true
})

[void]$form.ShowDialog()
