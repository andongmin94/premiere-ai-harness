# Premiere AI Harness qualification runner

This repository currently isolates and validates the Windows field-qualification runner that replaces the failed PowerShell/download-based path.

## What is verified in GitHub Actions

- Go unit tests and `go vet` on Ubuntu and Windows
- Windows x64 cross-build of `PremiereAIHarness-Qualification.exe`
- No PowerShell runner, Winget, Inno Setup, or runtime downloads in the qualification executable
- Seller configuration JSON, payload SHA-256, safe ZIP extraction, UPIA/Premiere discovery, staging, cleanup, and result collection logic

## What still needs a seller PC

GitHub-hosted runners do not contain Adobe Premiere Pro or an interactive Creative Cloud session. Actual UXP installation and Premiere GUI qualification must run later on a private self-hosted Windows runner or directly in the logged-in seller desktop session.
