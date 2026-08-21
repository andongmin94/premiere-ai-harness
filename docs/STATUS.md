# Status

## 0.1.0 Core

구현됨:

- UXP Manifest v5 / Premiere Pro 26.3+
- 선택 클립 검사와 소스 지문 확인
- Premiere transcript JSON export
- SRT / WebVTT / JSON parser
- Korean/English local rough-cut candidates
- deletion budget and minimum-kept-range safety
- frame-aligned hard-boundary subclips
- isolated generated bin and non-destructive sequence
- best-effort rollback
- deterministic CCX build
- Node unit and package tests

아직 실제 Adobe 호스트에서 검증해야 함:

- Creative Cloud Desktop CCX installation
- panel load in Premiere Pro 26.3+
- transcript export against a real clip
- subclip boundaries and A/V sync
- sequence persistence after save/reopen
- rollback behavior under host errors

고급 기능은 이 Core 전체 흐름이 실제 Premiere에서 통과하기 전에는 추가하지 않습니다.
