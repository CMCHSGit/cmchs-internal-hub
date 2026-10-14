# Sets up (or replaces) the Windows scheduled task that runs the Excel -> schedule import every 5 minutes
# while you're signed in to this PC. See apps/schedule/EXCEL-IMPORT.md first: the config file and the
# Firebase key must already be in place, and a dry run should look right.
#
#   powershell -ExecutionPolicy Bypass -File apps\schedule\scripts\install-excel-import-task.ps1
#   powershell -ExecutionPolicy Bypass -File apps\schedule\scripts\install-excel-import-task.ps1 -Remove
param([switch]$Remove)

$TaskName = 'CMCHS Excel to schedule import'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed '$TaskName' (if it was there)."
  return
}

$Script = (Resolve-Path (Join-Path $PSScriptRoot 'excel-import.mjs')).Path
$Node = (Get-Command node -ErrorAction Stop).Source
$Config = Join-Path $env:USERPROFILE '.cmchs\excel-import.json'
if (-not (Test-Path $Config)) { throw "No config at $Config - see apps/schedule/EXCEL-IMPORT.md." }

# conhost --headless runs node without a console window popping up every 5 minutes.
$Action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$Node`" `"$Script`" --apply" -WorkingDirectory (Split-Path $Script)
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Imports the CMCHS staff schedule workbook (OneDrive copy) into internal.chsnz.co.nz/schedule. Log: %USERPROFILE%\.cmchs\excel-import.log' -Force | Out-Null
Write-Output "Scheduled '$TaskName': every 5 minutes while you're signed in, starting in a minute."
Write-Output "Log: $(Join-Path $env:USERPROFILE '.cmchs\excel-import.log')"
