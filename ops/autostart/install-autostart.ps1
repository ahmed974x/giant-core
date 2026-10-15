# One-time setup so OMEGA comes back by itself after a reboot (ADR-064). Run once, in your own PowerShell:
#   powershell -ExecutionPolicy Bypass -File ops\autostart\install-autostart.ps1
# What it does (all per-user, reversible):
#   - Docker Desktop: "Start Docker Desktop when you sign in" on (settings-store.json AutoStart, backup kept next to it)
#   - Windows startup list: re-enables the Docker Desktop entry if it was switched off in Task Manager
#   - scheduled task "OMEGA Boot": at your sign-in (+45 s) runs ops\autostart\omega-boot.ps1 with no window
# Undo:
#   Unregister-ScheduledTask -TaskName "OMEGA Boot" -Confirm:$false
#   Docker Desktop > Settings > General > untick "Start Docker Desktop when you sign in"
$ErrorActionPreference = "Stop"

$settings = Join-Path $env:APPDATA "Docker\settings-store.json"
if (Test-Path $settings) {
    Copy-Item $settings "$settings.bak" -Force
    $j = Get-Content $settings -Raw | ConvertFrom-Json
    $j | Add-Member -NotePropertyName AutoStart -NotePropertyValue $true -Force
    $j | ConvertTo-Json -Depth 20 | Set-Content $settings -Encoding utf8
    "Docker Desktop AutoStart = $((Get-Content $settings -Raw | ConvertFrom-Json).AutoStart)"
} else {
    "Docker Desktop settings not found; tick 'Start Docker Desktop when you sign in' in its Settings > General"
}

$approved = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
if ((Get-ItemProperty $approved -ErrorAction SilentlyContinue)."Docker Desktop") {
    Set-ItemProperty $approved -Name "Docker Desktop" -Value ([byte[]](2,0,0,0,0,0,0,0,0,0,0,0)) -Type Binary
    "Docker Desktop startup entry: enabled"
}

$boot = Join-Path $PSScriptRoot "omega-boot.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$boot`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = "PT45S"
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable
Register-ScheduledTask -TaskName "OMEGA Boot" -Action $action -Trigger $trigger -Settings $set -Force `
    -Description "OMEGA: start Docker, the compose stack and the web app after sign-in (ADR-064)" | Out-Null
Get-ScheduledTask -TaskName "OMEGA Boot" | Select-Object TaskName, State
