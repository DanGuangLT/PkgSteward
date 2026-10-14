@echo off
rem Manager NPM - build the backend and the frontend, then start them in production mode.
rem Each app runs in its own window: press Ctrl+C there or close the window to stop it.
setlocal

rem ---- Settings ------------------------------------------------------------
set "BE_DIR=%~dp0pkgsteward_be"
set "FE_DIR=%~dp0pkgsteward_fe"
set "BE_CMD=pnpm build && pnpm start:prod"
set "FE_CMD=pnpm build && pnpm start"
rem Backend mode (Swagger is off in production). Overrides MODE from pkgsteward_be\.env.
set "MODE=production"
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

start "Manager NPM - backend (prod)" /D "%BE_DIR%" cmd /k "%BE_CMD%"
start "Manager NPM - frontend (prod)" /D "%FE_DIR%" cmd /k "%FE_CMD%"
echo Backend and frontend are building, then starting in production mode, each in its own window.
exit /b 0

:fail
pause
exit /b 1
