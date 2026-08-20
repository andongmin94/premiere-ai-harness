@echo off
setlocal
set "KIT_ROOT=%~dp0"
"%KIT_ROOT%PremiereAIHarness-Qualification.exe" smoke -kit "%KIT_ROOT%"
set "RC=%ERRORLEVEL%"
if not "%PAI_NONINTERACTIVE%"=="1" pause
exit /b %RC%
