@echo off
setlocal

REM Always run from this script's own folder (hakka\app), regardless of
REM where it was invoked from.
cd /d "%~dp0"

if "%~1"=="" (
    echo Usage: deploy.bat "commit message"
    exit /b 1
)

echo === collectstatic ===
python manage.py collectstatic --noinput
if errorlevel 1 exit /b 1

echo === git commit -a ===
git commit -a -m "%~1"
if errorlevel 1 exit /b 1

echo === git push ===
git push
if errorlevel 1 exit /b 1

echo === vercel --prod ===
vercel --prod
