# Status

## 0.2.0 Core public-beta candidate

구현 및 자동 검증됨:

- UXP Manifest v5 / Premiere Pro 26.3+
- 선택 클립 검사와 소스 지문 확인
- Premiere transcript JSON export
- SRT / WebVTT / JSON parser
- Korean/English local rough-cut candidates
- deletion budget and minimum-kept-range safety
- frame-aligned hard-boundary subclips
- isolated output bin and non-destructive sequence
- stale source and stale Premiere-transcript rejection
- rollback with explicit cleanup failure reporting
- one-click host self-test using a selected real source clip
- temporary subclip / bin / sequence postcondition verification
- strict self-test cleanup and prior active-sequence restoration
- recovery cleanup limited to internal self-test prefixes
- host certification bound to Premiere, UXP, plugin, OS, and architecture versions
- local plugin-data reset
- deterministic CCX build
- Node unit and package tests

실제 Adobe 호스트에서 최종 확인해야 함:

- Creative Cloud Desktop CCX installation
- panel load in Premiere Pro 26.3+
- one-click host self-test against a real source clip
- transcript export against a real clip
- subclip boundaries and A/V sync
- sequence persistence after save/reopen
- rollback behavior under host errors

현재 판매 라벨은 `Core 0.2.0 Public Beta`가 정확합니다. 실제 Premiere에서 위 항목을 통과하기 전에는 Stable/GA로 표시하지 않습니다.
