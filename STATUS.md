# Development status

모든 변경은 `main` 하나에만 반영합니다.

## 현재 제품

`Premiere AI Harness Core 0.5.1 — Distribution Qualification Candidate`

자동 검증 범위:

- 패널 DOM, UXP entrypoint, Premiere Pro 26.3 API 계약
- SRT·WebVTT·Adobe 중첩 JSON 전사문 파서
- 로컬 편집 플래너와 승인하지 않은 삭제 차단
- 프로젝트·원본·전사문 stale-state 차단
- 프레임 안쪽 정렬과 사라지는 유지 구간 차단
- 생성 시퀀스의 종료 시간·트랙·클립·경계 검증
- 부분 mutation 뒤 이번 작업의 시퀀스·빈·서브클립 롤백
- 동일 이름의 기존 사용자 시퀀스 보존
- 호스트 자체시험과 의도된 실패 롤백 시험
- 프로젝트 저장 전후와 새 패널 세션의 시퀀스 구조 동일성 검증
- 패널 부팅 및 핵심 사용자 흐름 모의시험
- 복잡도와 coverage 게이트
- Linux/Windows 교차 플랫폼 재현 소스 패키징
- 결정론적 CCX와 안전 경로·중복·암호화·CRC·소스 일치 검사

정확한 자동검증 결과는 해당 커밋의 **Product CI** 실행과 `PremiereAIHarness-Core-Distribution-Receipt` 아티팩트에서 확인합니다. 저장소 안에 CI 상태 영수증을 다시 커밋하지 않습니다.

## 남은 실제 Adobe 게이트

- Creative Cloud Desktop에서 exact CCX 설치
- Premiere Pro 26.3+ 패널 로드
- 실제 클립의 호스트·롤백 자체시험
- 실제 Premiere transcript export
- 서브클립 프레임 경계와 A/V sync
- 원본 시퀀스와 원본 미디어 불변
- 프로젝트 저장, Premiere 종료·재실행, 새 패널 세션 구조 확인
- 같은 ID의 후속 버전 업데이트 설치
- Creative Cloud Desktop 제거와 잔여 데이터 확인

전 항목을 판매자가 보관 가능한 증거로 통과하기 전에는 Public Beta, Stable, GA 또는 판매판으로 표시하지 않습니다.
