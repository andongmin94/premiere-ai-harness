# Development status

모든 변경은 `main` 하나에만 반영합니다.

## 현재 제품

`Premiere AI Harness Core 0.3.1 — Internal Host Qualification Candidate`

자동 검증 범위:

- 패널 DOM과 JavaScript 계약
- UXP panel entrypoint 등록
- Premiere Pro 26.3 API 계약
- 전사문 파서와 로컬 편집 플래너
- 프로젝트·원본·전사문 stale-state 차단
- 승인하지 않은 짧은 유지 구간의 암묵적 삭제 차단
- 프레임 정렬로 사라지는 유지 구간 차단
- 부분 mutation 뒤 시퀀스·빈·서브클립 롤백
- 사용자 항목이 섞인 생성 빈 보존과 명시적 오류
- exact-name 내부 시험 자산 정리
- 패널 부팅 및 핵심 사용자 흐름 모의시험
- 복잡도와 coverage 게이트
- 결정론적 unsigned UXP source directory 생성

## 남은 실제 Adobe 호스트 게이트

- Adobe UXP Developer Tool에서 source directory 로드
- Premiere Pro 26.3+ 패널 로드
- 실제 클립으로 호스트 자체시험 PASS
- 실제 Premiere transcript export
- 서브클립 프레임 경계와 A/V sync
- 저장·종료·재실행 후 시퀀스 유지
- 실제 호스트 오류에서 rollback 확인
- 공식 CCX 패키징·설치·제거

위 항목을 통과하기 전에는 Public Beta, Stable, GA 또는 판매판으로 표시하지 않습니다.
