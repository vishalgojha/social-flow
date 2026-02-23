@echo off
setlocal

set "SCRIPT=%~dp0install.ps1"
if not exist "%SCRIPT%" (
  echo install.ps1 not found.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "CODE=%ERRORLEVEL%"

if not "%CODE%"=="0" (
  echo.
  echo Installer failed with exit code %CODE%.
  pause
  exit /b %CODE%
)

echo.
echo Installer finished successfully.
choice /C YN /N /T 20 /D N /M "Start guided setup now? [Y/N] (auto N in 20s): " 2>nul
if errorlevel 3 goto :end
if errorlevel 2 goto :end

set "HAS_SOCIAL=0"
where social.cmd >nul 2>nul
if "%ERRORLEVEL%"=="0" set "HAS_SOCIAL=1"

echo.
echo Step 1/2: Authenticate Facebook access token
if "%HAS_SOCIAL%"=="1" (
  call social.cmd auth login -a facebook
) else (
  call node "%~dp0bin\social.js" auth login -a facebook
)
set "AUTH_CODE=%ERRORLEVEL%"

if not "%AUTH_CODE%"=="0" (
  echo.
  echo Authentication did not complete (exit code %AUTH_CODE%).
  choice /C YN /N /T 20 /D Y /M "Continue to interface selection anyway? [Y/N] (auto Y in 20s): "
  if errorlevel 2 goto :end
)

echo.
echo Step 2/2: Choose interface
echo   [1] Terminal UI ^(Hatch^)
echo   [2] Agentic Frontend ^(Social Studio web UI^)
echo   [3] Exit
choice /C 123 /N /M "Select [1/2/3]: "
if errorlevel 3 goto :end
if errorlevel 2 goto :launch_studio
if errorlevel 1 goto :launch_hatch
goto :end

:launch_hatch
if "%HAS_SOCIAL%"=="1" (
  echo Launching Hatch in a new window...
  start "Social CLI Hatch" cmd /k social.cmd hatch
) else (
  echo social command not on PATH yet. Launching local Hatch in a new window...
  start "Social CLI Hatch" cmd /k node "%~dp0bin\social.js" hatch
)
goto :end

:launch_studio
if "%HAS_SOCIAL%"=="1" (
  echo Launching Social Studio in a new window...
  start "Social Studio" cmd /k social.cmd studio
) else (
  echo social command not on PATH yet. Launching local Studio in a new window...
  start "Social Studio" cmd /k node "%~dp0bin\social.js" studio
)
goto :end

:end
pause
exit /b 0
