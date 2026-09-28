@echo off
cd /d "%~dp0"
"%~dp0app\Resim.exe" serve --projects-dir "%~dp0..\ResimProjects" --open-browser
if errorlevel 1 pause
