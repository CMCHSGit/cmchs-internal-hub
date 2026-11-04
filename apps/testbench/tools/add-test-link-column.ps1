<#
.SYNOPSIS
  Adds a "Test this device" button as the FIRST column of every table in a customer asset list. Each row's button opens the CHS Test Bench
  on the right template with the device's model, serial number and asset numbers filled in. Excel does the insert, so every formula,
  filter, validation and summary sheet is adjusted by Excel itself.

.DESCRIPTION
  Needs Excel on this PC. Close the workbook in Excel first. A copy of the file is kept first in an "Old" folder next to it
  ("<name> (before test links dd.MM.yyyy).xlsx"). Tables with no "Serial Number" column are left alone. A "Test this device" column that is
  already there (in any position) is replaced, so running this again brings an older version up to date.
  Use -Pick to choose the file in a window, -OutPath to write the result to a different file (to try it), -Recurse to do a whole folder.

.EXAMPLE
  .\add-test-link-column.ps1 -Pick
  .\add-test-link-column.ps1 -Path "C:\...\Waitemata DHB Asset List.xlsx"
  .\add-test-link-column.ps1 -Path "C:\...\Waitemata DHB Asset List.xlsx" -OutPath "C:\Temp\try.xlsx"
  .\add-test-link-column.ps1 -Path "C:\...\Public" -Recurse      # every "*Asset List*.xlsx" under a folder (not in Old folders)
#>
param(
  [string]$Path,
  [switch]$Pick,
  [string]$OutPath,
  [switch]$Recurse,
  [string]$Header = 'Test this device',
  [string]$BaseUrl = 'https://internal.chsnz.co.nz/testbench/'
)
$ErrorActionPreference = 'Stop'

if ($Pick -or -not $Path) {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'Choose the customer asset list (.xlsx)'; $dlg.Filter = 'Excel workbook (*.xlsx)|*.xlsx'; $dlg.Multiselect = $false
  if ($dlg.ShowDialog() -ne 'OK') { Write-Host 'Nothing chosen.'; return }
  $Path = $dlg.FileName
}

$files = @()
if (Test-Path -LiteralPath $Path -PathType Container) {
  if (-not $Recurse) { throw 'That is a folder: add -Recurse to do every asset list in it.' }
  $files = Get-ChildItem -LiteralPath $Path -Recurse -File -Filter '*Asset List*.xlsx' | Where-Object { $_.FullName -notmatch '\\Old\\' -and $_.Name -notmatch '^~\$' }
} else { $files = @(Get-Item -LiteralPath $Path) }
if (-not $files.Count) { Write-Host 'No asset lists found.'; return }
if ($OutPath -and $files.Count -gt 1) { throw '-OutPath is for one file.' }

$columns = @(@('model', 'Device Model'), @('serial', 'Serial Number'), @('manufacturer', 'Manufacturer'), @('asset', 'CHS Asset Number'), @('custasset', 'Customer Asset Number'), @('ward', 'Ward/Location'))

# Percent-encodes what would break a link (% space & # + / =) with plain SUBSTITUTE calls: no newer function (ENCODEURL is not in every Excel).
function Get-Encoded($ref) {
  $e = $ref
  foreach ($pair in @(@('%', '%25'), @(' ', '%20'), @('&', '%26'), @('#', '%23'), @('+', '%2B'), @('/', '%2F'), @('=', '%3D'))) { $e = 'SUBSTITUTE(' + $e + ',"' + $pair[0] + '","' + $pair[1] + '")' }
  return $e
}
function Get-Formula($names) {
  $parts = @(); $i = 0
  foreach ($c in $columns) {
    if ($names -contains $c[1]) { $sep = if ($i -eq 0) { '?' } else { '&' }; $parts += ('"' + $sep + $c[0] + '="&' + (Get-Encoded ('[@[' + $c[1] + ']]'))); $i++ }
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
          if (-not ($names -contains 'Serial Number')) { Write-Host "  $($ws.Name) / $($lo.Name): no Serial Number column, left alone"; continue }
          if ($lo.ShowTotals) { Write-Host "  $($ws.Name) / $($lo.Name): has a totals row, left alone"; continue }
          $replaced = $false
          if ($names -contains $Header) { $lo.ListColumns.Item($Header).Delete(); $replaced = $true; $names = @($names | Where-Object { $_ -ne $Header }) }
          $col = $lo.ListColumns.Add(1)
          $col.Name = $Header
          $body = $col.DataBodyRange
          $body.Formula = (Get-Formula $names)
          $col.Range.EntireColumn.ColumnWidth = 19
          # The header is black (red headers mean mandatory); the cells look like buttons: purple, white bold text, centred, a white edge.
          $body.HorizontalAlignment = -4108; $body.VerticalAlignment = -4108
          # Rows that have a link look like buttons (white bold text on CHS purple #554596, a white edge); rows with no serial number stay plain.
          # A rule that looks at the cell's own value, so it needs no cell reference.
          $body.FormatConditions.Delete() | Out-Null
          $fc = $body.FormatConditions.Add(1, 4, '=""')                         # xlCellValue, xlNotEqual, ""
          $fc.Interior.Color = 9848149; $fc.Font.Color = 16777215; $fc.Font.Bold = $true
          foreach ($b in -4131, -4152, -4160, -4107) { $edge = $fc.Borders.Item($b); $edge.LineStyle = 1; $edge.Color = 16777215 }   # left, right, top, bottom
          $col.Range.Cells.Item(1, 1).Font.Color = 0                            # the header is black: red headers mean mandatory
          $changed++
          Write-Host "  $($ws.Name) / $($lo.Name): $(if ($replaced) { 'replaced' } else { 'added' }) ($($body.Rows.Count) rows)"
        }
      }
      if ($changed) { $wb.Save() } else { Write-Host '  nothing to add' }
    } finally { $wb.Close($false) }
  }
} finally { $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
Write-Host "`nDone."
