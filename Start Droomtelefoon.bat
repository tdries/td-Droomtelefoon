@echo off
rem Droomtelefoon: double-click to play (Windows).
rem The first time it puts Node.js in this folder if the PC has none (~35 MB), installs the game's parts and asks for your
rem Claude API key once (kept in .env). Then it starts the game and opens the TV board and the Droomtelefoon in your browser.
rem Close this window to stop the game.
setlocal EnableExtensions
cd /d "%~dp0"
title Droomtelefoon
set "NODE_V=22.23.2"
if "%PORT%"=="" set "PORT=3000"
echo.
echo   Droomtelefoon
echo.

rem 1. Node.js 18+: this folder's own copy first, else one installed on the PC, else download one
set "NODE="
if exist ".runtime\node\node.exe" set "NODE=%CD%\.runtime\node\node.exe"
if not defined NODE for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"
if defined NODE "%NODE%" -e "process.exit(+process.versions.node.split('.')[0]>=18?0:1)" || set "NODE="
if not defined NODE (
  echo Eenmalig: Node.js %NODE_V% downloaden ^(+- 35 MB^). One-time download...
  powershell -NoProfile -Command "$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Force .runtime | Out-Null; Invoke-WebRequest 'https://nodejs.org/dist/v%NODE_V%/node-v%NODE_V%-win-x64.zip' -OutFile '.runtime\node.zip'; Expand-Archive '.runtime\node.zip' '.runtime' -Force; Remove-Item '.runtime\node.zip'; if (Test-Path '.runtime\node') { Remove-Item '.runtime\node' -Recurse -Force }; Rename-Item '.runtime\node-v%NODE_V%-win-x64' 'node'" || goto :fail
  set "NODE=%CD%\.runtime\node\node.exe"
)
for %%D in ("%NODE%") do set "PATH=%%~dpD;%PATH%"

rem 2. the game's own packages, once
if not exist "node_modules\@anthropic-ai\sdk" (
  echo Eenmalig: onderdelen installeren. Installing...
  call npm install --omit=dev --no-audit --no-fund || goto :fail
)

rem 3. the Claude API key, asked once
if defined ANTHROPIC_API_KEY goto :run
findstr /b /c:"ANTHROPIC_API_KEY=" .env >nul 2>&1 && goto :run
echo.
echo Je Claude API-sleutel (your Claude API key)
echo Maak er een op https://platform.claude.com/settings/keys en plak hem hieronder.
echo Leeg laten + Enter = demo zonder AI. (Leave empty for a demo without AI.)
set "KEY="
set /p "KEY=Sleutel / key: "
if defined KEY (> .env echo ANTHROPIC_API_KEY=%KEY%)

:run
rem 4. open the TV board and the Droomtelefoon a few seconds after the start
start "" /b powershell -NoProfile -Command "Start-Sleep 3; Start-Process 'http://localhost:%PORT%/'; Start-Sleep 1; Start-Process 'http://localhost:%PORT%/phone'"
echo.
echo Het spel draait. Laat dit venster open: sluiten = stoppen. (Keep this window open; closing it stops the game.)
"%NODE%" server.js
goto :eof

:fail
echo.
echo Er ging iets mis. (Something went wrong.)
pause
exit /b 1
