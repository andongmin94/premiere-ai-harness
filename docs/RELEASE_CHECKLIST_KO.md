# Core 0.5.1 배포 자격검증 체크리스트

## exact 커밋 자동 게이트

- [ ] Linux / Windows `npm ci`와 `npm run verify` 성공
- [ ] 패널 부팅·핵심 흐름 모의시험 성공
- [ ] 부분 mutation rollback 시험 성공
- [ ] 전사·플래너·시퀀스 구조 회귀시험 성공
- [ ] coverage와 모듈 복잡도 예산 통과
- [ ] Linux / Windows source tree SHA-256 일치
- [ ] 결정론적 CCX 2회 빌드 바이트 일치
- [ ] CCX manifest 루트, 안전 경로, 중복 없음
- [ ] 암호화·ZIP data descriptor·숨은 바이트 없음
- [ ] CCX CRC와 source directory 파일별 바이트 일치
- [ ] `PremiereAIHarness-Core-Distribution-Receipt`가 대상 커밋과 일치

## 실제 Adobe 호스트·설치 게이트

- [ ] Product CI receipt의 커밋과 CCX SHA-256 확인
- [ ] CCX 더블클릭 후 Creative Cloud Desktop 설치 성공
- [ ] Premiere Pro 26.3+에서 패널 표시
- [ ] 일반 원본 클립의 `호스트 자체시험` PASS
- [ ] `실패 롤백 자체시험` PASS와 내부 자산 0개
- [ ] 실제 Premiere 전사문 불러오기
- [ ] 새 러프컷 생성 및 원본 불변 확인
- [ ] 프레임 경계와 A/V sync 확인
- [ ] 프로젝트 저장·구조 기록 성공
- [ ] Premiere 실제 종료·재실행
- [ ] 새 패널 세션에서 저장된 시퀀스 구조 동일성 PASS
- [ ] 같은 ID의 후속 버전 업데이트 설치
- [ ] Creative Cloud Desktop 제거 후 패널 미노출 확인
- [ ] 프로젝트 결과물 외 플러그인 전용 잔여 데이터 확인

전 항목 통과 전에는 판매하거나 Public Beta, Stable, GA로 표시하지 않습니다.
