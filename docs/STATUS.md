# Status

## Core 0.4.0 Host Qualification Candidate

구현 및 자동 검증됨:

- UXP Manifest v5 / Premiere Pro 26.3+
- 선택 클립 검사와 프로젝트·소스 지문 확인
- Premiere transcript JSON export
- SRT / WebVTT / JSON parser
- Korean/English local rough-cut candidates
- deletion budget and minimum-kept-range safety
- frame-aligned hard-boundary subclips
- isolated output bin and non-destructive sequence
- stale source and stale Premiere-transcript rejection
- rollback with explicit cleanup failure reporting
- one-click host self-test using a selected real source clip
- intentional rollback self-test before sequence creation
- temporary subclip / bin / sequence postcondition verification
- strict self-test cleanup and prior active-sequence restoration
- recovery cleanup limited to exact internal names
- host certification bound to Premiere, UXP, plugin, OS, and architecture versions
- persistent host qualification record without transcript or media content
- next-session persistence confirmation bound to project and sequence identity
- deterministic cross-platform unsigned UXP source directory
- Node unit, integration, failure-injection, coverage, complexity, and package tests

실제 Adobe 호스트에서 최종 확인해야 함:

- Adobe UXP Developer Tool source loading
- panel load in Premiere Pro 26.3+
- one-click host and rollback self-tests against a real source clip
- transcript export against a real clip
- subclip boundaries and A/V sync
- original sequence and media remain unchanged
- sequence persistence after save/reopen
- official CCX packaging and Creative Cloud install/update/uninstall

현재 라벨은 `Core 0.4.0 Host Qualification Candidate`가 정확합니다. 실제 Premiere 검증 기록과 공식 CCX 설치 수명주기를 통과하기 전에는 Public Beta, Stable 또는 GA로 표시하지 않습니다.
