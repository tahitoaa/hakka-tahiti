@echo off
setlocal

REM Always run from this script's own folder (hakka\app), regardless of
REM where it was invoked from.
cd /d "%~dp0"

if "%~1"=="" (
    echo Usage: deploy.bat "commit message"
    exit /b 1
)

echo === tests ===
REM "call" is required: npm is a .cmd script and would otherwise end this one.
call npm test
if errorlevel 1 (
    echo Tests failed, aborting deploy.
    exit /b 1
)

REM The project's own Python when there is one (venv), else the system one.
set PY=python
if exist venv\Scripts\python.exe set PY=venv\Scripts\python.exe

echo === collectstatic ===
%PY% manage.py collectstatic --noinput
if errorlevel 1 exit /b 1

REM Before the new code goes live: the database it needs. .env points at
REM the production database, so this migrates production.
echo === migrate ===
%PY% manage.py migrate --noinput
if errorlevel 1 (
    echo Migration failed, aborting deploy.
    exit /b 1
)

echo === git commit -a ===
git commit -a -m "%~1"
if errorlevel 1 exit /b 1

echo === git push ===
git push
if errorlevel 1 exit /b 1

echo === vercel --prod ===
vercel --prod
