# Status — Core 0.3.1

## 구현 및 자동 검증됨

- Manifest v5 / Premiere Pro 26.3+
- UXP panel entrypoint registration
- 단일 선택 원본 검사와 프로젝트·클립 식별자 고정
- Premiere transcript JSON / SRT / WebVTT / 지원 JSON
- 한국어·영어 재촬영, 무음, 필러, 인접 반복 후보
- 삭제량 상한과 최소 유지 구간 안전 규칙
- 사용자 승인하지 않은 구간의 암묵적 삭제 차단
- 프레임 안쪽 정렬과 0-frame 유지 구간 차단
- 최대 500개 출력 구간 제한
- 하드 바운더리 서브클립과 격리된 출력 빈
- 부분 실패 후 exact-name rollback
- 사용자 항목이 섞인 빈의 보존
- 호스트 자체시험과 필수 4개 검사 기반 인증
- 플러그인 소유 storage key만 초기화
- 패널 부팅·통합 흐름·실패 주입·랜덤 속성시험
- Core 0.3.1 unsigned UXP source directory

## 실제 호스트에서 남은 확인

실제 Premiere와 Adobe 패키징은 자동 모형시험으로 대체할 수 없습니다. `docs/RELEASE_CHECKLIST_KO.md`를 모두 통과하기 전에는 판매판이 아닙니다.
