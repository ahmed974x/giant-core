# OMEGA PRIME keys window: two boxes, paste with Ctrl+V, press Save. No PIN, no terminal.
# The values go to web/scripts/keys-form-save.mjs on stdin; they are never shown, logged or passed as arguments.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$web = Join-Path $PSScriptRoot '..\web' | Resolve-Path

$form = New-Object System.Windows.Forms.Form
$form.Text = 'OMEGA PRIME - المفاتيح'
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

[void](Add-Label 'الصق كل مفتاح في خانته (Ctrl+V)، بعدين اضغط حفظ.' 15 12 $true)
$form.Size = New-Object System.Drawing.Size(560, 770)
[void](Add-Label 'مفتاح NASA FIRMS (32 حرف: أرقام وحروف a إلى f)' 55)
$firms = Add-Box 85
$firmsHint = Add-Label '' 117 9
[void](Add-Label 'مفتاح AISStream (من aisstream.io، عادةً 40 حرف)' 150)
$ais = Add-Box 180
$aisHint = Add-Label '' 212 9
# Free AI keys for Oracle's fast path (ADR-058). Both free; nothing paid is accepted here.
[void](Add-Label 'مفتاح Groq المجاني (يبدأ بـ gsk_ ، من console.groq.com/keys)' 240)
$groq = Add-Box 270
$groqHint = Add-Label '' 302 9
[void](Add-Label 'مفتاح Cerebras المجاني (يبدأ بـ csk- ، من cloud.cerebras.ai)' 325)
$cer = Add-Box 355
$cerHint = Add-Label '' 387 9
[void](Add-Label 'مفتاح Gemini المجاني، اختياري (يبدأ بـ AIza ، من aistudio.google.com/apikey)' 410)
$gem = Add-Box 440
$gemHint = Add-Label '' 472 9

$green = [System.Drawing.Color]::FromArgb(16, 185, 129); $red = [System.Drawing.Color]::FromArgb(239, 68, 68); $grey = [System.Drawing.Color]::FromArgb(148, 160, 184)
# Shape check while typing: tells Ahmad at once whether he pasted a key or something else (only length and character
# kinds are inspected; nothing is shown or stored).
function Test-Shape($box, $hint, $kind) {
  $v = $box.Text.Trim()
  if (-not $v) { $hint.Text = 'فاضية (ما بتتغيّر)'; $hint.ForeColor = $grey; return $true }
  $n = $v.Length
  if ($v -match '\s') { $hint.Text = "فيها مسافات أو كلام زيادة ($n حرف). انسخ المفتاح بس."; $hint.ForeColor = $red; return $false }
  if ($n -eq 32 -and $v -cmatch '[A-Z_]' -and $v -cmatch '[a-z]') { $hint.Text = "هذا شكله رمز رابط الإيميل، مو مفتاح ($n حرف)."; $hint.ForeColor = $red; return $false }
  if ($kind -eq 'groq') {
    if ($v -cmatch '^gsk_[A-Za-z0-9]{40,64}$') { $hint.Text = "$n حرف ✓ شكله مفتاح Groq"; $hint.ForeColor = $green; return $true }
    $hint.Text = "$n حرف ✗ مفتاح Groq يبدأ بـ gsk_ وطوله حوالي 56"; $hint.ForeColor = $red; return $false
  }
  if ($kind -eq 'cerebras') {
    if ($v -cmatch '^csk-[A-Za-z0-9]{30,80}$') { $hint.Text = "$n حرف ✓ شكله مفتاح Cerebras"; $hint.ForeColor = $green; return $true }
    $hint.Text = "$n حرف ✗ مفتاح Cerebras يبدأ بـ csk-"; $hint.ForeColor = $red; return $false
  }
  if ($kind -eq 'gemini') {
    if ($v -cmatch '^AIza[0-9A-Za-z_-]{35}$') { $hint.Text = "39 حرف ✓ شكله مفتاح Gemini"; $hint.ForeColor = $green; return $true }
    $hint.Text = "$n حرف ✗ مفتاح Gemini يبدأ بـ AIza وطوله 39"; $hint.ForeColor = $red; return $false
  }
  if ($kind -eq 'nasa') {
    if ($v -match '^[0-9a-fA-F]{32}$') { $hint.Text = "32 حرف ✓ شكله مفتاح NASA صحيح"; $hint.ForeColor = $green; return $true }
    $hint.Text = "$n حرف ✗ مو شكل مفتاح NASA (لازم 32 حرف أرقام وحروف a-f)"; $hint.ForeColor = $red; return $false
  }
  if ($v -match '^[0-9a-fA-F]{40}$') { $hint.Text = "40 حرف ✓ شكله مفتاح AISStream"; $hint.ForeColor = $green; return $true }
  if ($v -match '^[0-9a-fA-F-]{30,64}$') { $hint.Text = "$n حرف، ممكن يكون المفتاح. نجرّبه."; $hint.ForeColor = $grey; return $true }
  $hint.Text = "$n حرف ✗ مو شكل مفتاح AISStream"; $hint.ForeColor = $red; return $false
}
$firms.Add_TextChanged({ [void](Test-Shape $firms $firmsHint 'nasa') })
$ais.Add_TextChanged({ [void](Test-Shape $ais $aisHint 'ais') })
$groq.Add_TextChanged({ [void](Test-Shape $groq $groqHint 'groq') })
$gem.Add_TextChanged({ [void](Test-Shape $gem $gemHint 'gemini') })
$cer.Add_TextChanged({ [void](Test-Shape $cer $cerHint 'cerebras') })
[void](Test-Shape $cer $cerHint 'cerebras')
[void](Test-Shape $firms $firmsHint 'nasa'); [void](Test-Shape $ais $aisHint 'ais'); [void](Test-Shape $groq $groqHint 'groq'); [void](Test-Shape $gem $gemHint 'gemini')

$show = New-Object System.Windows.Forms.CheckBox
$show.Text = 'أظهر اللي لصقته (تتأكد إنه المفتاح بس)'
$show.Location = New-Object System.Drawing.Point(20, 500); $show.Size = New-Object System.Drawing.Size(500, 20)
$show.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$show.Add_CheckedChanged({ foreach ($b in @($firms, $ais, $groq, $cer, $gem)) { $b.UseSystemPasswordChar = -not $show.Checked } })
$form.Controls.Add($show)

$save = New-Object System.Windows.Forms.Button
$save.Text = 'حفظ وتشفير'
$save.Location = New-Object System.Drawing.Point(20, 527); $save.Size = New-Object System.Drawing.Size(500, 48)
$save.BackColor = [System.Drawing.Color]::FromArgb(245, 179, 1); $save.ForeColor = [System.Drawing.Color]::FromArgb(10, 14, 26)
$save.FlatStyle = 'Flat'; $save.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($save)

$result = Add-Label '' 585 11
$result.Size = New-Object System.Drawing.Size(500, 110)

$save.Add_Click({
  if (-not (Test-Shape $firms $firmsHint 'nasa') -or -not (Test-Shape $ais $aisHint 'ais') -or -not (Test-Shape $groq $groqHint 'groq') -or -not (Test-Shape $gem $gemHint 'gemini') -or -not (Test-Shape $cer $cerHint 'cerebras')) {
    $result.ForeColor = $red; $result.Text = 'ما حفظت شي: فيه خانة مكتوب تحتها بالأحمر. صحّحها أو فضّها.'; return
  }
  if (-not $firms.Text.Trim() -and -not $ais.Text.Trim() -and -not $groq.Text.Trim() -and -not $gem.Text.Trim() -and -not $cer.Text.Trim()) { $result.ForeColor = $red; $result.Text = 'الخانتين فاضيات.'; return }
  $save.Enabled = $false; $result.ForeColor = [System.Drawing.Color]::White; $result.Text = 'جاري الحفظ والفحص...'
  $form.Refresh()
  $payload = @{ NASA_FIRMS_KEY = $firms.Text.Trim(); AISSTREAM_API_KEY = $ais.Text.Trim(); GROQ_API_KEY = $groq.Text.Trim(); GEMINI_API_KEY = $gem.Text.Trim(); CEREBRAS_API_KEY = $cer.Text.Trim() } | ConvertTo-Json -Compress
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'node'; $psi.Arguments = 'scripts/keys-form-save.mjs'; $psi.WorkingDirectory = $web
  $psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true; $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.Write($payload); $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd(); $p.WaitForExit()
  $payload = $null
  $lines = ($out -split "`n" | Where-Object { $_ -match '^(NASA_FIRMS_KEY|AISSTREAM_API_KEY|GROQ_API_KEY|CEREBRAS_API_KEY|GEMINI_API_KEY|CORTEX|ERROR):' }) -join "`n"
  if ($p.ExitCode -eq 1) {
    $result.ForeColor = [System.Drawing.Color]::FromArgb(239, 68, 68); $result.Text = "ما انحفظ: $lines"; $save.Enabled = $true; return
  }
  $firms.Text = ''; $ais.Text = ''; $groq.Text = ''; $cer.Text = ''; $gem.Text = ''
  # Restart the site so it picks the keys up.
  $c = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { Stop-Process -Id $c.OwningProcess -Force }
  Start-Process -FilePath node -ArgumentList 'scripts/secure-run.mjs','start','-p','3100','-H','127.0.0.1' -WorkingDirectory $web -WindowStyle Hidden
  $nice = $lines -replace ': ok - ', ': شغال ✓ ' -replace ': invalid - ', ': مرفوض ✗ ' -replace ': unreachable - ', ': ما قدرت أتأكد '
  $result.ForeColor = if ($p.ExitCode -eq 0) { [System.Drawing.Color]::FromArgb(16, 185, 129) } else { [System.Drawing.Color]::FromArgb(249, 115, 22) }
  $result.Text = "انحفظ مشفّر. النتيجة:`n$nice"
  $save.Enabled = $true
})

[void]$form.ShowDialog()
