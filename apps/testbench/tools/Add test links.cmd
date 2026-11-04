@echo off
rem Double-click: choose a customer asset list (.xlsx) and the "Test this device" buttons are added as its first column.
rem Needs Excel on this PC. Close the workbook in Excel first. A copy is kept in an "Old" folder next to it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0add-test-link-column.ps1" -Pick
echo.
pause
