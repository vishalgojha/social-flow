@echo off
setlocal
set "NODE_EXE="

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

call :refresh_path_from_registry
call :resolve_node
if not defined NODE_EXE (
  echo.
  echo WARNING: Node.js executable was not found after install.
  echo Guided setup is unavailable in this shell.
  echo Open a new terminal and run:
  echo   node "%~dp0bin\social.js" auth login -a facebook
  echo   node "%~dp0bin\social.js" hatch
)

echo.
echo Installer finished successfully.
choice /C YN /N /T 20 /D N /M "Start guided setup now? [Y/N] (auto N in 20s): " 2>nul
if errorlevel 2 goto :end
if not defined NODE_EXE goto :end

echo.
echo Step 1/2: Authenticate Facebook access token
call :run_social auth login -a facebook
set "AUTH_CODE=%ERRORLEVEL%"

if not "%AUTH_CODE%"=="0" (
  echo.
  echo Authentication did not complete ^(exit code %AUTH_CODE%^).
  choice /C YN /N /T 20 /D Y /M "Continue to interface selection anyway? [Y/N] ^(auto Y in 20s^): "
  if errorlevel 2 goto :end
)

echo.
echo Step 2/2: Choose interface
echo   [1] Terminal UI ^(Hatch, this window^)
echo   [2] Agentic Frontend ^(Studio, this window^)
echo   [3] Terminal UI ^(Hatch, new window^)
echo   [4] Agentic Frontend ^(Studio, new window^)
echo   [5] Exit
choice /C 12345 /N /T 30 /D 1 /M "Select [1/2/3/4/5] ^(auto 1 in 30s^): "
if errorlevel 5 goto :end
if errorlevel 4 goto :launch_studio_new
if errorlevel 3 goto :launch_hatch_new
if errorlevel 2 goto :launch_studio_here
if errorlevel 1 goto :launch_hatch_here
goto :end

:launch_hatch_here
echo Launching Hatch in this window...
call :run_social hatch
set "UI_CODE=%ERRORLEVEL%"
if not "%UI_CODE%"=="0" (
  echo.
  echo Hatch exited with code %UI_CODE%.
)
goto :end

:launch_studio_here
echo Launching Social Studio in this window...
call :run_social studio
set "UI_CODE=%ERRORLEVEL%"
if not "%UI_CODE%"=="0" (
  echo.
  echo Studio exited with code %UI_CODE%.
)
goto :end

:launch_hatch_new
echo Launching Hatch in a new window...
start "Social CLI Hatch" cmd /k ""%NODE_EXE%" "%~dp0bin\social.js" hatch"
goto :end

:launch_studio_new
echo Launching Social Studio in a new window...
start "Social Studio" cmd /k ""%NODE_EXE%" "%~dp0bin\social.js" studio"
goto :end

:refresh_path_from_registry
set "REG_PATH="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$m=[Environment]::GetEnvironmentVariable('Path','Machine');$u=[Environment]::GetEnvironmentVariable('Path','User');$p='';if($m){$p+=$m};if($u){if($p){$p+=';'};$p+=$u};[Console]::Write($p)"`) do set "REG_PATH=%%P"
if defined REG_PATH set "PATH=%PATH%;%REG_PATH%"
exit /b 0

:resolve_node
set "NODE_EXE="
for %%I in (node.exe) do if not defined NODE_EXE set "NODE_EXE=%%~$PATH:I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
exit /b 0

:run_social
if not defined NODE_EXE call :resolve_node
if not defined NODE_EXE exit /b 9009
"%NODE_EXE%" "%~dp0bin\social.js" %*
exit /b %ERRORLEVEL%

:end
echo.
echo Setup finished.
choice /C X /N /M "Press X to close this installer window: "
exit /b 0
