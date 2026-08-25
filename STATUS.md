# Development status

모든 변경은 `main` 하나에만 반영합니다.

## 현재 제품

`Premiere AI Harness Core 0.4.0 — Host Qualification Candidate`

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
- 호스트 자체시험과 의도된 실패 롤백 자체시험
- 실제 Premiere 전사문·러프컷·재생·재실행 단계의 영속 검증 기록
- 패널 부팅 및 핵심 사용자 흐름 모의시험
- 복잡도와 coverage 게이트
- Linux/Windows 교차 플랫폼 재현 패키징
- 결정론적 unsigned UXP source directory 생성

## 남은 실제 Adobe 호스트 게이트

- Adobe UXP Developer Tool에서 source directory 로드
- Premiere Pro 26.3+ 패널 로드
- 실제 클립으로 호스트 자체시험 PASS
- 실제 클립으로 의도된 실패 롤백 자체시험 PASS
- 실제 Premiere transcript export
- 서브클립 프레임 경계와 A/V sync
- 원본 시퀀스와 원본 미디어 불변 확인
- 저장·종료·재실행 후 시퀀스 유지 확인
- 공식 CCX 패키징·설치·업데이트·제거

플러그인 안의 검증 기록이 PASS가 되더라도 위 실기기 결과를 판매자가 직접 보관하기 전에는 Public Beta, Stable, GA 또는 판매판으로 표시하지 않습니다.
