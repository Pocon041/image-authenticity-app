@echo off
setlocal
cd /d "%~dp0"
for /d %%D in ("%~dp0.tools\node-v*-win-x64") do set "PATH=%%~fD;%PATH%"
node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22||(major===22&&minor<12)){console.error('Please install Node 24 LTS, or provide a local runtime in .tools.');process.exit(1)}"
if errorlevel 1 exit /b 1
call npm.cmd %*
exit /b %errorlevel%
