# Core 0.4.0 실제 Premiere 출시 체크리스트

## 자동 게이트

- [x] `npm ci`
- [x] `npm run verify`
- [x] 패널 부팅 모의시험
- [x] 부분 mutation rollback 시험
- [x] 전사·플래너 랜덤 속성시험
- [x] 결정론적 unsigned UXP source directory
- [x] 외부 프로세스·네트워크 권한 없음
- [x] Linux / Windows source tree 재현성

## 플러그인 내부 실제 호스트 검증

- [ ] 현재 원본으로 검증 시작
- [ ] 일반 원본 클립으로 `호스트 자체시험` PASS
- [ ] 같은 원본으로 `실패 롤백 자체시험` PASS
- [ ] 자체시험 뒤 내부 자산 0개
- [ ] 실제 Premiere 전사문 불러오기
- [ ] 새 러프컷 생성 및 원본 불변 확인
- [ ] 프레임 경계와 A/V sync 확인
- [ ] 프로젝트 저장 후 Premiere 종료
- [ ] Premiere 재실행 후 생성 시퀀스 재탐색 PASS
- [ ] 기계 판독용 검증 기록의 최종 `status`가 `PASS`

## 배포 게이트

- [ ] Adobe UXP Developer Tool에서 source directory 로드
- [ ] Premiere Pro 26.3+에서 패널 표시
- [ ] Adobe UXP Developer Tool로 공식 CCX 패키징
- [ ] Creative Cloud 설치
- [ ] 같은 ID의 이전 버전에서 업데이트
- [ ] Creative Cloud 제거
- [ ] 제거 후 원본 프로젝트와 사용자 결과물 보존 확인

전 항목 통과 전에는 판매하거나 Public Beta, Stable 또는 GA로 표시하지 않습니다.
