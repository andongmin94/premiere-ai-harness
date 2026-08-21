# Development status

All work is committed directly to `main`; no secondary branches are used.

## Verified on GitHub-hosted runners

- Full product source imported as normal repository files
- Product verification on Ubuntu and Windows
- Native Go qualification runner unit tests, `go vet`, smoke path, Windows x64 build, and real `.cmd` entrypoints
- Reproducible product release build when the repository exposes a release script
- Complete offline qualification kit assembly with pinned Node.js, FFmpeg/ffprobe, Codex, product source, Studio CCX, and SHA-256 manifest
- Bundled runtime executable startup checks
- Full pre-Premiere qualification path on Windows using deterministic Adobe test doubles:
  - payload verification and safe extraction
  - Studio staging
  - CCX install/list/remove lifecycle
  - real Companion startup with bundled Node.js and product source
  - result collection
  - owned-path cleanup

Machine-readable successful-run receipts are written to:

- `reports/product-ci.json`
- `reports/offline-kit-ci.json`
- `reports/pre-premiere-e2e.json`

## Remaining host gate

GitHub-hosted runners do not include Adobe Premiere Pro, Creative Cloud Desktop, or a logged-in interactive Adobe session. The remaining gate is the exact Studio artifact running inside real Premiere Pro:

- UXP panel load
- host certification
- multicam edit
- automatic B-roll
- MOGRT captions
- final audio mix
- export and render QA
- save, reopen, and rollback behavior

A private interactive Windows runner workflow will be enabled only after its exact artifact and cleanup path are pinned to a successful offline-kit receipt.
