# Makes the cell edits the app -> Excel copy planned (scripts/excelExportJob.mjs), in Excel itself, so the
# workbook keeps all its formatting and stays safe for people editing it at the same time (OneDrive co-authoring).
#
# Input  -Edits   a JSON list of { sheet, row, col, before, text }
# Output -Result  { state, statuses } with one status per edit, in order: written | mismatch | failed
#
# Each cell is checked first: if it no longer says what it said when the plan was made (someone just changed it),
# or holds a formula, it is left alone ('mismatch'). Nothing is ever cleared. If the workbook is already open in
# the Excel that is running on this PC it is edited there; otherwise it is opened in a hidden Excel of its own.
param(
  [Parameter(Mandatory = $true)][string]$Workbook,
  [Parameter(Mandatory = $true)][string]$Edits,
  [Parameter(Mandatory = $true)][string]$Result
)
$ErrorActionPreference = 'Stop'

function Norm($s) { return (([string]$s) -replace '[\s ]+', ' ').Trim().ToLowerInvariant() }

# Windows PowerShell hands a JSON list back as ONE array object, so pass it through the pipeline to get its items.
# (PowerShell variable names ignore case, so this can't be called $edits: that is the -Edits parameter.)
$list = @(Get-Content -Raw -Encoding UTF8 $Edits | ConvertFrom-Json | ForEach-Object { $_ })
$statuses = New-Object System.Collections.ArrayList
$state = 'ok'
$excel = $null; $wb = $null; $startedHere = $false; $openedHere = $false

try {
  try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch { $excel = $null }
  if ($excel) {
    foreach ($w in $excel.Workbooks) { if ($w.FullName -ieq $Workbook) { $wb = $w; break } }
  }
  if (-not $wb) {
    $excel = New-Object -ComObject Excel.Application
    $startedHere = $true
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.AskToUpdateLinks = $false
    $wb = $excel.Workbooks.Open($Workbook, 0, $false)
    $openedHere = $true
    if ($wb.ReadOnly) { $state = 'locked' }
  }

  if ($state -eq 'ok') {
    $changed = 0
    $done = @{}      # target cell -> the text now in it (an AM and a PM cell merged into one are one cell)
    $wanted = @{}    # target cell -> the texts wanted in it; two different ones can't both be written
    $targets = @{}
    for ($i = 0; $i -lt $list.Count; $i++) {
      try {
        $c = $wb.Worksheets.Item([string]$list[$i].sheet).Cells.Item([int]$list[$i].row, [int]$list[$i].col)
        if ($c.MergeCells) { $c = $c.MergeArea.Cells.Item(1, 1) }
        $key = ([string]$list[$i].sheet) + '!' + $c.Address($false, $false)
        $targets[$i] = $c
        if (-not $wanted.ContainsKey($key)) { $wanted[$key] = @{} }
        $wanted[$key][(Norm $list[$i].text)] = $true
      } catch { }
    }
    for ($i = 0; $i -lt $list.Count; $i++) {
      $e = $list[$i]
      try {
        $cell = $targets[$i]
        $key = ([string]$e.sheet) + '!' + $cell.Address($false, $false)
        if ($wanted[$key].Count -gt 1) { [void]$statuses.Add('failed'); continue }          # a merged AM/PM cell can't hold two different texts
        if ($done.ContainsKey($key)) { [void]$statuses.Add('written'); continue }            # the other half of a merged cell, already set
        if ($cell.HasFormula -or ((Norm $cell.Value2) -ne (Norm $e.before))) { [void]$statuses.Add('mismatch'); continue }
        $cell.Value2 = [string]$e.text
        $done[$key] = $true
        $changed++
        [void]$statuses.Add('written')
      } catch {
        [void]$statuses.Add('failed')
      }
    }
    if ($changed -gt 0) { $wb.Save() }
  }
} catch {
  $state = 'error: ' + $_.Exception.Message
} finally {
  try { if ($openedHere -and $wb) { $wb.Close($false) } } catch { }
  try { if ($startedHere -and $excel) { $excel.Quit() } } catch { }
  foreach ($o in @($wb, $excel)) { if ($o) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } } }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}

$json = @{ state = $state; statuses = @($statuses) } | ConvertTo-Json -Compress
Set-Content -Path $Result -Value $json -Encoding UTF8
