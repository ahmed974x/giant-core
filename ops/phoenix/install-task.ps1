# Registers the Phoenix watchdog as a per-user scheduled task that runs every 5 minutes (ADR-020).
# No admin rights; runs only while you are logged on; no console window (pythonw).
#   powershell -ExecutionPolicy Bypass -File ops\phoenix\install-task.ps1          # install / update
#   schtasks /Delete /TN "OMEGA Phoenix" /F                                       # remove
$core = Resolve-Path "$PSScriptRoot\..\.."
$py = Join-Path $core "services\director00\.venv\Scripts\pythonw.exe"
$script = Join-Path $core "scripts\phoenix.py"
if (-not (Test-Path $py)) { throw "Director 00 venv missing: $py" }
schtasks /Create /TN "OMEGA Phoenix" /SC MINUTE /MO 5 /TR "`"$py`" `"$script`"" /F | Out-Null
schtasks /Query /TN "OMEGA Phoenix" /FO LIST | Select-String "TaskName|Next Run Time|Status"
