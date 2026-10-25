@echo off
setlocal
cd /d "%~dp0"

echo This will commit all current changes in this repository and push them to GitHub.
set /p "commit_message=What did you change? Enter a commit message: "

if not defined commit_message (
    echo A commit message is required. Nothing was pushed.
    pause
    exit /b 1
)

git add -A
if errorlevel 1 goto error

git diff --cached --quiet
if not errorlevel 1 (
    echo There are no changes to commit.
    pause
    exit /b 0
)

git commit -m "%commit_message%"
if errorlevel 1 goto error

git push
if errorlevel 1 goto error

echo.
echo Changes pushed to GitHub successfully.
pause
exit /b 0

:error
echo.
echo A Git step failed. Review the message above; earlier steps may already have completed.
pause
exit /b 1
