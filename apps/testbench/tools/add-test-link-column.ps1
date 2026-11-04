<#
.SYNOPSIS
  Adds a "Test this device" column as the FIRST column of every table in a customer asset list (Excel does the insert, so every formula,
  filter, validation and summary sheet is adjusted by Excel itself). Each row's link opens the CHS Test Bench on the right template with the
  device's model, serial number and asset numbers filled in.

.DESCRIPTION
  Needs Excel on this PC. Close the workbook in Excel first. A copy of the file is kept first in an "Old" folder next to it
  ("<name> (before test links dd.MM.yyyy).xlsx"). Tables with no "Serial Number" column, or that already have the column, are left alone.
  Use -OutPath to write the result to a different file instead of changing the original (to try it).

.EXAMPLE
  .\add-test-link-column.ps1 -Path "C:\...\Waitemata DHB Asset List.xlsx"
  .\add-test-link-column.ps1 -Path "C:\...\Waitemata DHB Asset List.xlsx" -OutPath "C:\Temp\try.xlsx"
  .\add-test-link-column.ps1 -Path "C:\...\Public" -Recurse      # every "*Asset List*.xlsx" under a folder (not in Old folders)
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$OutPath,
  [switch]$Recurse,
  [string]$Header = 'Test this device',
  [string]$BaseUrl = 'https://internal.chsnz.co.nz/testbench/'
)
$ErrorActionPreference = 'Stop'

$files = @()
if (Test-Path -LiteralPath $Path -PathType Container) {
  if (-not $Recurse) { throw 'That is a folder: add -Recurse to do every asset list in it.' }
  $files = Get-ChildItem -LiteralPath $Path -Recurse -File -Filter '*Asset List*.xlsx' | Where-Object { $_.FullName -notmatch '\\Old\\' -and $_.Name -notmatch '^~\$' }
} else { $files = @(Get-Item -LiteralPath $Path) }
if (-not $files.Count) { Write-Host 'No asset lists found.'; return }
if ($OutPath -and $files.Count -gt 1) { throw '-OutPath is for one file.' }

$columns = @(@('model', 'Device Model'), @('serial', 'Serial Number'), @('manufacturer', 'Manufacturer'), @('asset', 'CHS Asset Number'), @('custasset', 'Customer Asset Number'), @('ward', 'Ward/Location'))

function Get-Formula($names) {
  $parts = @()
  $i = 0
  foreach ($c in $columns) {
    if ($names -contains $c[1]) { $sep = if ($i -eq 0) { '?' } else { '&' }; $parts += ('"' + $sep + $c[0] + '="&ENCODEURL([@[' + $c[1] + ']])'); $i++ }
  }
  return '=IF([@[Serial Number]]="","",HYPERLINK("' + $BaseUrl + '"&' + ($parts -join '&') + ',"' + $Header + '"))'
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  foreach ($file in $files) {
    Write-Host "`n$($file.FullName)"
    $target = $file.FullName
    if ($OutPath) { Copy-Item -LiteralPath $file.FullName -Destination $OutPath -Force; $target = (Resolve-Path -LiteralPath $OutPath).Path }
    else {
      $old = Join-Path $file.DirectoryName 'Old'
      if (-not (Test-Path -LiteralPath $old)) { New-Item -ItemType Directory -Path $old | Out-Null }
      $copy = Join-Path $old ($file.BaseName + ' (before test links ' + (Get-Date -Format 'dd.MM.yyyy') + ')' + $file.Extension)
      if (-not (Test-Path -LiteralPath $copy)) { Copy-Item -LiteralPath $file.FullName -Destination $copy }
      Write-Host "  copy kept: $copy"
    }
    $wb = $xl.Workbooks.Open($target)
    $changed = 0
    try {
      foreach ($ws in $wb.Worksheets) {
        foreach ($lo in $ws.ListObjects) {
          $names = @(); foreach ($lc in $lo.ListColumns) { $names += $lc.Name }
          if ($names -contains $Header) { Write-Host "  $($ws.Name) / $($lo.Name): already has it"; continue }
          if (-not ($names -contains 'Serial Number')) { Write-Host "  $($ws.Name) / $($lo.Name): no Serial Number column, left alone"; continue }
          if ($lo.ShowTotals) { Write-Host "  $($ws.Name) / $($lo.Name): has a totals row, left alone"; continue }
          $col = $lo.ListColumns.Add(1)
          $col.Name = $Header
          $col.DataBodyRange.Formula = (Get-Formula $names)
          $head = $col.Range.Cells.Item(1, 1)
          $head.Font.Color = 0            # black: red headers mark the mandatory columns
          $col.Range.EntireColumn.ColumnWidth = 18
          $changed++
          Write-Host "  $($ws.Name) / $($lo.Name): added ($($col.DataBodyRange.Rows.Count) rows)"
        }
      }
      if ($changed) { $wb.Save() } else { Write-Host '  nothing to add' }
    } finally { $wb.Close($false) }
  }
} finally { $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
Write-Host "`nDone."
