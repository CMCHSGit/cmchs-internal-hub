# Makes the cell edits the app -> Excel copy planned (scripts/excelExportJob.mjs), in Excel itself, so the
# workbook keeps all its formatting and stays safe for people editing it at the same time (OneDrive co-authoring).
#
# Input  -Edits   a JSON list of { sheet, row, col, before, text }
# Output -Result  { state, statuses } with one status per edit, in order: written | mismatch | failed
#
# Each cell is checked first: if it no longer says what it said when the plan was made (someone just changed it),
# or holds a formula, it is left alone ('mismatch'). Nothing is ever cleared. A whole-day cell (AM and PM merged)
# that the app wants as two different halves is unmerged and written as two (4 Nov 2026). If the workbook is already open in
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
$excelPid = 0
$pidFile = Join-Path $env:USERPROFILE '.cmchs\excel-writeback.pid'

# The hidden Excel this script starts can fail to quit (a save to OneDrive that hangs, the run being
# stopped), and then it keeps the workbook open, so every later run says "Excel cannot access the file".
# So the script remembers the one it started, and removes it if it is still there: at the end of
# the run, and at the start of the next one. Only ever that one process, and only while it still has
# no window (an Excel someone opened themselves is never touched).
function Stop-OwnExcel([int]$id) {
  if ($id -le 0) { return }
  try {
    $p = Get-Process -Id $id -ErrorAction Stop
    if ($p.ProcessName -eq 'EXCEL' -and $p.MainWindowHandle -eq 0) { $p.Kill(); [void]$p.WaitForExit(5000) }
  } catch { }
}
try {
  if (Test-Path $pidFile) { Stop-OwnExcel ([int](Get-Content $pidFile -ErrorAction Stop)); Remove-Item $pidFile -ErrorAction SilentlyContinue }
} catch { }

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
    try {
      Add-Type -Namespace Cmchs -Name Win -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int pid);' -ErrorAction Stop
      $owner = 0
      [void][Cmchs.Win]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$owner)
      $excelPid = $owner
      if ($excelPid -gt 0) { New-Item -ItemType Directory -Force -Path (Split-Path $pidFile) | Out-Null; Set-Content -Path $pidFile -Value $excelPid }
    } catch { }
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
    # An AM and a PM cell merged into one is a whole day: one text for both halves. When the app wants the two halves to
    # differ, the merged cell has to be split, as a person would by hand: the AM text in the top half and the PM text in
    # the bottom half. That includes a plan that changes only ONE half (the other half's text is the merged cell's
    # own, so it isn't in the plan): writing the merged cell then would change both halves, and the next plan would
    # change them back, round and round. Only a merge of exactly those two cells (two rows, one column), only while
    # the cell still says what it said when the plan was made and holds no formula. Anything else is left alone.
    $splitResult = @{}   # target cell -> written | mismatch | failed, for the cells that are split
    foreach ($key in @($wanted.Keys)) {
      try {
        $idx = @(0..($list.Count - 1) | Where-Object { $targets.ContainsKey($_) -and ((([string]$list[$_].sheet) + '!' + $targets[$_].Address($false, $false)) -eq $key) })
        if ($idx.Count -eq 0) { continue }
        $top = $targets[$idx[0]]
        if (-not $top.MergeCells) { continue }
        $area = $top.MergeArea
        if ($area.Rows.Count -ne 2 -or $area.Columns.Count -ne 1) { continue }
        $topRow = [int]$top.Row
        $whole = [string]$top.Value2
        $am = $whole; $pm = $whole; $rowsOk = $true; $textsOk = -not $top.HasFormula
        foreach ($j in $idx) {
          $r = [int]$list[$j].row
          if ($r -eq $topRow) { $am = [string]$list[$j].text } elseif ($r -eq ($topRow + 1)) { $pm = [string]$list[$j].text } else { $rowsOk = $false }
          if ((Norm $list[$j].before) -ne (Norm $whole)) { $textsOk = $false }
        }
        if ((Norm $am) -eq (Norm $pm) -and $rowsOk) { continue }   # one text for the whole day: the ordinary write below
        $outcome = 'failed'
        if ($rowsOk) {
          if (-not $textsOk) { $outcome = 'mismatch' }
          else {
            $sheet = $top.Worksheet
            $col = [int]$top.Column
            $area.UnMerge()
            $sheet.Cells.Item($topRow, $col).Value2 = $am
            $sheet.Cells.Item($topRow + 1, $col).Value2 = $pm
            $changed++
            $outcome = 'written'
          }
        }
        $splitResult[$key] = $outcome
      } catch { $splitResult[$key] = 'failed' }
    }
    for ($i = 0; $i -lt $list.Count; $i++) {
      $e = $list[$i]
      try {
        $cell = $targets[$i]
        $key = ([string]$e.sheet) + '!' + $cell.Address($false, $false)
        if ($splitResult.ContainsKey($key)) { [void]$statuses.Add([string]$splitResult[$key]); continue }  # split above (or not, and why)
        if ($wanted[$key].Count -gt 1) { [void]$statuses.Add('failed'); continue }          # two different texts for one cell that wasn't split
        if ($done.ContainsKey($key)) { [void]$statuses.Add('written'); continue }            # the other half of a merged cell, already set
        # Already says what the plan wants (the other half of a merged AM/PM cell, whose whole-day text was written for the first half): nothing to do.
        if (-not $cell.HasFormula -and (Norm $cell.Value2) -eq (Norm $e.text)) { $done[$key] = $true; [void]$statuses.Add('written'); continue }
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
  if ($excelPid -gt 0) {
    Start-Sleep -Seconds 3   # let a normal Quit finish; if the process is still there, it is stuck
    Stop-OwnExcel $excelPid
    Remove-Item $pidFile -ErrorAction SilentlyContinue
  }
}

$json = @{ state = $state; statuses = @($statuses) } | ConvertTo-Json -Compress
Set-Content -Path $Result -Value $json -Encoding UTF8
