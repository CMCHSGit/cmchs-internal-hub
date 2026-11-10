@echo off
rem One click: bring every customer asset list and the Simpro template up to the master list. See sync-asset-lists.ps1.
title Sync asset lists
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-asset-lists.ps1"
echo.
pause
