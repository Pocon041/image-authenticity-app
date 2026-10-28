@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\package.json" (
  call run.cmd ci --include=dev
  if errorlevel 1 goto failed
)
call run.cmd run dev
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo SRDP could not start. See the error above.
pause
exit /b 1
