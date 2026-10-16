# Registers "OMEGA Paper Scan": every day at 09:00 local time (the laptop runs on Kuwait time) it queues paper trade
# proposals and writes the briefing (ADR-073). Proposals only: nothing is recorded until Ahmad taps Approve.
# No admin rights; runs only while you are logged on; no console window (pythonw).
#   powershell -ExecutionPolicy Bypass -File ops\phoenix\install-paper-scan.ps1   # install / update
#   schtasks /Delete /TN "OMEGA Paper Scan" /F                                    # remove
$core = Resolve-Path "$PSScriptRoot\..\.."
$py = Join-Path $core "services\director00\.venv\Scripts\pythonw.exe"
$script = Join-Path $core "scripts\phoenix.py"
if (-not (Test-Path $py)) { throw "Director 00 venv missing: $py" }
schtasks /Create /TN "OMEGA Paper Scan" /SC DAILY /ST 09:00 /TR "`"$py`" `"$script`" paper-scan" /F | Out-Null
schtasks /Query /TN "OMEGA Paper Scan" /FO LIST | Select-String "TaskName|Next Run Time|Status"
