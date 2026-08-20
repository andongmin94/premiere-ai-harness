@echo off
setlocal
for %%I in ("%~dp0.") do set "KIT_ROOT=%%~fI"
"%KIT_ROOT%\PremiereAIHarness-Qualification.exe" cleanup -kit "%KIT_ROOT%"
set "RC=%ERRORLEVEL%"
if not "%PAI_NONINTERACTIVE%"=="1" pause
exit /b %RC%
