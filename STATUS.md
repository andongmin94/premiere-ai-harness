# Development status

모든 변경은 `main`에 직접 반영하며 보조 브랜치를 사용하지 않습니다.

## 현재 제품

`Premiere AI Harness Core 0.2.0 Public Beta Candidate`

- 단일 UXP CCX
- 외부 Companion, Node.js, FFmpeg, Codex, localhost 서비스 없음
- 로컬 전사 기반 검토형 러프컷
- 실제 편집 전에 Premiere 환경별 호스트 자체시험 필수
- 자체시험 자산은 생성·검증·정리까지 완료돼야 인증됨

## GitHub-hosted CI 검증

- JavaScript 문법 및 DOM 계약
- Adobe Premiere Pro 26.3 API 계약
- transcript / planner / Premiere adapter / host certification tests
- action creation inside `Project.lockedAccess()`
- stale source and stale transcript rejection
- rollback and cleanup-failure reporting
- deterministic CCX packaging and ZIP integrity
- Windows artifact: `dist/PremiereAIHarness-Core-0.2.0.ccx`

## 남은 실제 Adobe 호스트 게이트

- Creative Cloud Desktop에서 exact CCX 설치
- Premiere Pro 26.3+ 패널 로드
- 실제 클립으로 패널의 호스트 자체시험 PASS
- 실제 Premiere transcript export
- subclip 프레임 경계와 A/V sync
- 저장·종료·재실행 후 시퀀스 유지
- 강제 오류 시 rollback과 내부 시험 흔적 정리

Self-hosted GitHub runner는 사용하지 않습니다. 최종 호스트 확인은 완성된 CCX를 설치한 뒤 Premiere 패널 내부의 원클릭 자체시험으로 수행합니다.
