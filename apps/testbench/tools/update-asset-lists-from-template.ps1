<#
.SYNOPSIS
  Brings the customer asset lists up to the master list (the Waitemata one): the warranty formulas and the Component drop-down list.
  Excel does the work, so formatting, filters, validation and everything else in a list stays as it is.

.DESCRIPTION
  What it copies from the template list (-Template, default: the Waitemata DHB Asset List):
    1. The formula of the columns in -Columns (default "End of Warranty Date" and "Extended Warranty"), taken from the template's -TemplateTable
       (default T_WTH), into every table in the customer list that has that column. Only cells that hold a FORMULA are replaced: a value somebody
       typed in is never touched. A table that lacks a column the formula refers to (for example Manufacturing Date) is left alone and reported.
    2. The Component drop-down list (Reference sheet, the "Component" name): when the customer's list only holds items the template also has,
       it becomes the template's list. If the customer has items of their own, it is left alone and reported.
  Optional: -FillEmpty "<column>",... also puts the formula in EMPTY cells of those columns (only where every column the formula uses has a value in
  that row, e.g. a MAC address from the Device ID). The formula is read from the first row in the template that holds a formula of its own
  (a typed value, or a formula pointing at another table such as T_NSH[@...], is skipped), and a copy that points at another table is replaced.
  -ExcludePattern "<regex>" leaves out -Folder lists whose path matches it.
  Nothing else changes: no rows, columns, sheets, formats or other drop-downs. Drift in other lists is not touched.
  With -Apply a list that needs no change is not saved and keeps no copy.
  sync-asset-lists.ps1 (and "Sync asset lists.cmd") is the one-click version of all this.

  Three ways to run it (needs Excel on this PC; close the lists in Excel first):
    (no switch)  Report only: it edits a temporary copy to count what WOULD change, and deletes it. Nothing is written anywhere.
    -OutDir X    Trial: edited COPIES are saved in folder X. The originals are never opened for writing.
    -Apply       Real: a copy of each list is kept first in an "Old" folder next to it ("<name> (before template update dd.MM.yyyy).xlsx"),
                 then the list is changed in place. A list that is open elsewhere (read-only when opened) is skipped.

.EXAMPLE
  .\update-asset-lists-from-template.ps1 -Folder "C:\...\Customer Data\Human\Public" -Recurse
  .\update-asset-lists-from-template.ps1 -Path "C:\...\Hutt Valley DHB Asset List 22.10.2026.xlsx" -OutDir C:\Temp\trial
  .\update-asset-lists-from-template.ps1 -Folder "C:\...\Public" -Recurse -Apply
#>
param(
  [string]$Template,
  [string[]]$Path,
  [string]$Folder,
  [switch]$Recurse,
  [string]$OutDir,
  [switch]$Apply,
  [string]$TemplateTable = 'T_WTH',
  [string[]]$Columns = @('End of Warranty Date', 'Extended Warranty'),
  [string]$ListName = 'Component',
  [switch]$AlignOwnItems,  # also replace a customer's own Component items (when no row uses them) with the template's
  [string[]]$FillEmpty = @(),  # of the -Columns, these also get the formula in EMPTY cells when every column it uses has a value in that row (typed values are never touched)
  [string]$ExcludePattern      # regex; -Folder lists whose full path matches it are left out (e.g. archived copies)
)
$ErrorActionPreference = 'Stop'
$public = Join-Path $env:USERPROFILE 'Cass Medical Limited\Cass & CHS SharePoint - Documents (1)\CMCHS Files\Service\Customer Data\Human\Public'
if (-not $Template) { $Template = Join-Path $public 'Waitemata\_Mindray\- Customer Info\- Asset List\Waitemata DHB Asset List.xlsx' }
if ($OutDir -and $Apply) { throw 'Use -OutDir (trial copies) or -Apply (change the lists in place), not both.' }

# ---- which lists
$files = @()
if ($Path) { foreach ($p in $Path) { $files += Get-Item -LiteralPath $p } }
if ($Folder) {
  $files += Get-ChildItem -LiteralPath $Folder -Recurse:$Recurse -File -Filter '*Asset List*.xlsx' |
    Where-Object { $_.FullName -notmatch '\\(Old|Backups)\\' -and $_.Name -notmatch '^~\$' -and $_.Name -notmatch 'Template' -and $_.Name -notmatch 'BADGE' -and $_.FullName -ne (Resolve-Path -LiteralPath $Template).Path -and (-not $ExcludePattern -or $_.FullName -notmatch $ExcludePattern) }
}
$files = @($files | Sort-Object FullName -Unique)
if (-not $files.Count) { Write-Host 'No asset lists found.'; return }
if ($OutDir -and -not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

function Norm($v) { if ($null -eq $v) { return '' }; return ([string]$v).Trim().ToLowerInvariant() }
function Get-Used($formula) { [regex]::Matches($formula, '\[@\[([^\]]+)\]\]') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique }

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false; $xl.AskToUpdateLinks = $false
$xl.AutoCorrect.AutoFillFormulasInLists = $false   # entering a formula in one table cell must not fill the whole column (it would overwrite typed values)
$summary = New-Object System.Collections.Generic.List[object]
$tmpDir = Join-Path $env:TEMP ('asset-template-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
try {
  # ---- the template: read its formulas and its Component list from a private copy
  $tcopy = Join-Path $tmpDir 'template.xlsx'
  Copy-Item -LiteralPath $Template -Destination $tcopy
  $tw = $xl.Workbooks.Open($tcopy, 0, $true)
  $tf = @{}
  foreach ($ws in $tw.Worksheets) {
    foreach ($lo in $ws.ListObjects) {
      if ($lo.Name -ne $TemplateTable) { continue }
      foreach ($c in $Columns) {
        foreach ($lc in $lo.ListColumns) {
          if ($lc.Name -ne $c) { continue }
          # the first row that holds a formula of its own (not a typed value, not one that points at another table, e.g. T_NSH[@...])
          for ($k = 1; $k -le $lc.DataBodyRange.Rows.Count; $k++) {
            $x = [string]$lc.DataBodyRange.Cells.Item($k, 1).Formula
            if ($x.StartsWith('=') -and $x -notmatch '\w\[@') { $tf[$c] = $x; break }
          }
        }
      }
    }
  }
  foreach ($c in $Columns) { if (-not $tf.ContainsKey($c)) { throw "The template has no '$c' column in table $TemplateTable." } }
  $tList = @()
  try {
    $vals = $tw.Names.Item($ListName).RefersToRange.Value2
    foreach ($v in $vals) { if ($v) { $tList += [string]$v } }
  } catch { Write-Host "  (the template has no '$ListName' list: that part is skipped)" }
  $tw.Close($false)
  Write-Host "Template: $Template"
  foreach ($c in $Columns) { Write-Host ("  {0}: {1}" -f $c, ($tf[$c] -replace '\s*\r?\n\s*', ' ')) }
  Write-Host "  $ListName list: $($tList.Count) items"
  Write-Host ("Mode: " + $(if ($Apply) { 'APPLY (changes the lists in place, a copy goes to Old first)' } elseif ($OutDir) { "TRIAL (edited copies go to $OutDir)" } else { 'REPORT ONLY (nothing is written)' }))

  foreach ($file in $files) {
    Write-Host "`n$($file.FullName)"
    $row = [ordered]@{ List = $file.Name; Tables = 0; FormulasChanged = 0; Filled = 0; ValuesChanged = 0; TypedKept = 0; Component = '-'; Notes = '' }
    $notes = @()
    $keep = $false; $changed = $false; $madeCopy = $false
    if ($Apply) {
      $target = $file.FullName
      $old = Join-Path $file.DirectoryName 'Old'
      if (-not (Test-Path -LiteralPath $old)) { New-Item -ItemType Directory -Path $old | Out-Null }
      $copy = Join-Path $old ($file.BaseName + ' (before template update ' + (Get-Date -Format 'dd.MM.yyyy') + ')' + $file.Extension)
      $madeCopy = $false
      if (-not (Test-Path -LiteralPath $copy)) { Copy-Item -LiteralPath $file.FullName -Destination $copy; $madeCopy = $true }
      $keep = $true
    } elseif ($OutDir) {
      $target = Join-Path $OutDir $file.Name
      Copy-Item -LiteralPath $file.FullName -Destination $target -Force
      $keep = $true
    } else {
      $target = Join-Path $tmpDir $file.Name
      Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }
    try { $wb = $xl.Workbooks.Open($target, 0, $false) }
    catch {
      Write-Host '  could not be opened (open in Excel or being synced): skipped. Close it and run again.'
      $row.Notes = 'SKIPPED: open elsewhere'; $summary.Add([pscustomobject]$row)
      if (-not $keep) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
      continue
    }
    try {
      if ($Apply -and $wb.ReadOnly) {
        Write-Host '  open elsewhere (read-only): skipped'; $row.Notes = 'SKIPPED: open elsewhere'; $summary.Add([pscustomobject]$row)
        if ($madeCopy) { Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue }
        continue
      }
      foreach ($ws in $wb.Worksheets) {
        foreach ($lo in $ws.ListObjects) {
          $names = @(); foreach ($lc in $lo.ListColumns) { $names += $lc.Name }
          if ($lo.ListRows.Count -eq 0) { continue }
          $touched = $false
          foreach ($c in $Columns) {
            if (-not ($names -contains $c)) { continue }
            $missing = @(Get-Used $tf[$c] | Where-Object { $names -notcontains $_ })
            if ($missing.Count) { $notes += "$($ws.Name)/$($lo.Name): '$c' left (no '$($missing -join "', '")' column)"; continue }
            $rng = $lo.ListColumns.Item($c).DataBodyRange
            $fs = $rng.Formula; $vs0 = $rng.Value2
            $n = $rng.Rows.Count
            $nForm = 0; $nDiff = 0; $nTyped = 0
            for ($i = 1; $i -le $n; $i++) {
              $f = [string]$fs[$i, 1]
              if ($f.StartsWith('=')) { $nForm++; if (($f -replace '\s+', '') -ne ($tf[$c] -replace '\s+', '')) { $nDiff++ } }
              elseif ($f -ne '') { $nTyped++ }
            }
            $row.TypedKept += $nTyped
            # Empty cells: only with -FillEmpty, and only where every column the formula uses has a value in that row.
            $fillRows = @()
            if ($FillEmpty -contains $c) {
              $usedCols = @(Get-Used $tf[$c])
              for ($i = 1; $i -le $n; $i++) {
                if ([string]$fs[$i, 1] -ne '') { continue }
                $ok = ($usedCols.Count -gt 0)
                foreach ($u in $usedCols) { if (-not [string]$lo.ListColumns.Item($u).DataBodyRange.Cells.Item($i, 1).Value2) { $ok = $false; break } }
                if ($ok) { $fillRows += $i }
              }
            }
            if ($nDiff -eq 0 -and -not $fillRows.Count) { continue }
            if ($nTyped -eq 0 -and $nForm -eq $n) { $rng.Formula = $tf[$c] }
            else {
              for ($i = 1; $i -le $n; $i++) { $cell = $rng.Cells.Item($i, 1); if ($cell.HasFormula) { $cell.Formula = $tf[$c] } }
              foreach ($i in $fillRows) { $rng.Cells.Item($i, 1).Formula = $tf[$c] }
            }
            $xl.Calculate()
            $vs1 = $rng.Value2
            for ($i = 1; $i -le $n; $i++) { if ([string]$vs0[$i, 1] -ne [string]$vs1[$i, 1]) { $row.ValuesChanged++ } }
            $row.FormulasChanged += $nDiff; $row.Filled += $fillRows.Count; $touched = $true; $changed = $true
            Write-Host "  $($ws.Name) / $($lo.Name) / ${c}: $nDiff of $n formulas replaced$(if ($fillRows.Count) { ", $($fillRows.Count) empty cells filled" })$(if ($nTyped) { ", $nTyped typed values kept" })"
          }
          if ($touched) { $row.Tables++ }
        }
      }
      # ---- the Component list
      if ($tList.Count) {
        $nm = $null; foreach ($x in $wb.Names) { if ($x.Name -eq $ListName) { $nm = $x } }
        if (-not $nm) { $row.Component = 'no list'; }
        else {
          $rg = $nm.RefersToRange; $sh = $rg.Worksheet
          $have = @(); foreach ($v in $rg.Value2) { if ($v) { $have += [string]$v } }
          $tset = @($tList | ForEach-Object { Norm $_ })
          $own = @($have | Where-Object { $tset -notcontains (Norm $_) })
          $add = @($tList | Where-Object { (@($have | ForEach-Object { Norm $_ })) -notcontains (Norm $_) })
          # An item of the customer's own is only replaced with -AlignOwnItems, and only when no row of any table uses it as a Device Model.
          $ownBlock = @()
          if ($own.Count) {
            if (-not $AlignOwnItems) { $ownBlock = $own }
            else {
              $usedModels = @{}
              foreach ($w2 in $wb.Worksheets) { foreach ($l2 in $w2.ListObjects) {
                $n2 = @(); foreach ($c2 in $l2.ListColumns) { $n2 += $c2.Name }
                if (($n2 -contains 'Device Model') -and $l2.ListRows.Count) { foreach ($m in $l2.ListColumns.Item('Device Model').DataBodyRange.Value2) { if ($m) { $usedModels[(Norm $m)] = 1 } } }
              } }
              $ownBlock = @($own | Where-Object { $usedModels.ContainsKey((Norm $_)) })
            }
          }
          if ($ownBlock.Count) { $row.Component = 'own items, left'; $notes += "Component list has its own items (" + ($ownBlock -join ', ') + ")" + $(if ($AlignOwnItems) { ' that rows use' }) + ': left alone' }
          elseif (-not $own.Count -and -not $add.Count -and $have.Count -eq $tList.Count) { $row.Component = 'same' }
          else {
            $first = $rg.Row; $col = $rg.Column; $last = $first + $tList.Count - 1
            # Cells under the list may already hold template items that the name just stops short of (Dunedin, West Coast): fine. Anything else under it blocks.
            $blocked = $false
            for ($r = $first + $rg.Rows.Count; $r -le $last; $r++) { $v = $sh.Cells.Item($r, $col).Value2; if ($v -and ($tset -notcontains (Norm $v))) { $blocked = $true } }
            if ($blocked) { $row.Component = 'no room, left'; $notes += 'Component list: cells under it hold other things, left alone' }
            else {
              for ($i = 0; $i -lt $tList.Count; $i++) { $sh.Cells.Item($first + $i, $col).Value2 = $tList[$i] }
              for ($i = $tList.Count; $i -lt $rg.Rows.Count; $i++) { $sh.Cells.Item($first + $i, $col).ClearContents() | Out-Null }
              $nm.RefersTo = '=' + $sh.Range($sh.Cells.Item($first, $col), $sh.Cells.Item($last, $col)).Address($true, $true, 1, $true)
              $row.Component = "now $($tList.Count) (+$($add.Count))"; $changed = $true
              Write-Host "  $ListName list: $($have.Count) -> $($tList.Count) items (+$($add -join ', '))"
            }
          }
        }
      }
      if ($Apply -and -not $changed) {
        # nothing to do: the list is not saved (it stays exactly as it was) and no copy is kept
        if ($madeCopy) { Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue }
        Write-Host '  already up to date'
      } elseif ($keep) {
        if ($Apply) { Write-Host "  copy kept: $copy" }
        try { $wb.Save() }
        catch { Write-Host "  NOT SAVED: $($_.Exception.Message) (the list is unchanged; close it elsewhere and run again)"; $notes += 'NOT SAVED'; $row.FormulasChanged = 0; $row.Filled = 0 }
      }
    } finally { $wb.Close($false) }
    $row.Notes = ($notes -join '; ')
    $summary.Add([pscustomobject]$row)
    if (-not $keep) { Remove-Item -LiteralPath $target -Force }
  }
} finally {
  $xl.Quit(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "`n=== Summary"
$summary | Format-Table List, Tables, FormulasChanged, Filled, ValuesChanged, TypedKept, Component -AutoSize | Out-String -Width 220 | Write-Host
foreach ($r in $summary) { if ($r.Notes) { Write-Host ("- {0}: {1}" -f $r.List, $r.Notes) } }
Write-Host "`nDone."
