@echo off
rem Manager NPM - start the backend and the frontend in development mode (watch / hot reload).
rem Each app runs in its own window: press Ctrl+C there or close the window to stop it.
setlocal

rem ---- Settings ------------------------------------------------------------
set "BE_DIR=%~dp0manager_npm_be"
set "FE_DIR=%~dp0manager_npm_fe"
set "BE_CMD=pnpm dev"
set "FE_CMD=pnpm dev"
rem --------------------------------------------------------------------------

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [error] pnpm was not found on PATH. Install Node.js 24 and pnpm 11 first.
  goto :fail
)

for %%D in ("%BE_DIR%" "%FE_DIR%") do (
  if not exist "%%~D\node_modules\" (
    echo Installing dependencies in %%~D
    pushd "%%~D"
    call pnpm install --frozen-lockfile
    if errorlevel 1 (
      popd
      echo [error] pnpm install failed in %%~D
      goto :fail
    )
    popd
  )
)

start "Manager NPM - backend (dev)" /D "%BE_DIR%" cmd /k "%BE_CMD%"
start "Manager NPM - frontend (dev)" /D "%FE_DIR%" cmd /k "%FE_CMD%"
echo Backend and frontend are starting in development mode, each in its own window.
exit /b 0

:fail
pause
exit /b 1
