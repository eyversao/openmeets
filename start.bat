@echo off
REM OpenMeets - arranque local en http://localhost:5050/
setlocal
chcp 65001 >nul
title OpenMeets
mode con cols=100 lines=46 >nul 2>nul
cd /d "%~dp0"
if exist "nativo\target\release\openmeets.exe" (
    "nativo\target\release\openmeets.exe" %*
    goto :fin
)
where node >nul 2>nul
if not %errorlevel%==0 (
    echo.
    echo   No encuentro Node.js. Instalalo desde https://nodejs.org ^(version 20 o superior^) y abre este archivo otra vez.
    echo   Node.js was not found. Install it from https://nodejs.org ^(v20 or newer^) and open this file again.
    echo.
    pause
    goto :eof
)
node servidor\openmeets.mjs %*
:fin
echo.
echo   OpenMeets se ha detenido. / OpenMeets has stopped.
pause
