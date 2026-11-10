<#
.SYNOPSIS
  One click: bring every customer asset list and the Simpro template up to the master list (the Waitemata WTH tab).

.DESCRIPTION
  Edit the master (Waitemata DHB Asset List.xlsx, WTH tab, table T_WTH), save and close it, then double-click
  "Sync asset lists" (the .cmd next to this file, or the shortcut on the desktop).

  1. It first REPORTS what would change in each list (on temporary copies; nothing is written).
  2. You type YES to go ahead (anything else stops, nothing changed).
  3. It changes the lists in place. Before a list is changed, a copy goes to the Old folder next to it
     ("<name> (before template update dd.MM.yyyy).xlsx"). A list with nothing to change is left exactly as it is.
     A list that is open in Excel is skipped: close it and run again.

  What is copied from the master (see update-asset-lists-from-template.ps1 for the details):
    - the formulas of End of Warranty Date, Extended Warranty, Mindray LAN MAC Address, Mindray MID Number
      (only cells that already hold a formula; typed values are never touched)
    - empty MAC / MID cells that have a Device ID get the formula
    - the Component drop-down list
  Left out on purpose: the Old and Backups folders, the badge lists, the archived 2022 / 2023 Waitemata copies.
  To add a column to copy, add its name to $columns below (the master must hold a formula in it).

  -Yes skips the question (for a scheduled run); -ReportOnly stops after the report.
#>
param([switch]$Yes, [switch]$ReportOnly)
$ErrorActionPreference = 'Stop'
$tool = Join-Path $PSScriptRoot 'update-asset-lists-from-template.ps1'
$sp = Join-Path $env:USERPROFILE 'Cass Medical Limited\Cass & CHS SharePoint - Documents (1)\CMCHS Files\Service'
$public = Join-Path $sp 'Customer Data\Human\Public'
$master = Join-Path $public 'Waitemata\_Mindray\- Customer Info\- Asset List\Waitemata DHB Asset List.xlsx'
$simpro = Get-ChildItem -LiteralPath (Join-Path $sp 'Mindray\Asset List Templates for Simpro') -File -Filter 'Asset List Template*.xlsx' |
  Where-Object { $_.Name -notmatch '^~\$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$columns = @('End of Warranty Date', 'Extended Warranty', 'Mindray LAN MAC Address', 'Mindray MID Number')
$fill = @('Mindray LAN MAC Address', 'Mindray MID Number')
$common = @{
  Template = $master; Folder = $public; Recurse = $true; Path = @($master) + $(if ($simpro) { @($simpro.FullName) } else { @() })
  Columns = $columns; FillEmpty = $fill; ExcludePattern = 'EST and PVT|WDHB Asset List - Shared'
}
if (-not (Test-Path -LiteralPath $master)) { throw "The master list was not found: $master" }
Write-Host "Master: $master"
Write-Host 'Step 1 of 2: checking every list (nothing is changed yet)...' -ForegroundColor Cyan
& $tool @common
if ($ReportOnly) { return }
if (-not $Yes) {
  Write-Host ''
  $a = Read-Host 'Change the lists as shown above? A copy of each changed list goes to its Old folder first. Type YES to go ahead'
  if ($a -ne 'YES') { Write-Host 'Stopped. Nothing was changed.'; return }
}
Write-Host "`nStep 2 of 2: updating the lists..." -ForegroundColor Cyan
& $tool @common -Apply
