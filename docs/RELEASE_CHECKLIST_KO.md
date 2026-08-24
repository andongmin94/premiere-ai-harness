# Core 0.3.1 실제 Premiere 출시 체크리스트

## 자동 게이트

- [x] `npm ci`
- [x] `npm run verify`
- [x] 패널 부팅 모의시험
- [x] 부분 mutation rollback 시험
- [x] 전사·플래너 랜덤 속성시험
- [x] 결정론적 unsigned UXP source directory
- [x] 외부 프로세스·네트워크 권한 없음

## 실제 Adobe 호스트 게이트

- [ ] Adobe UXP Developer Tool에서 source directory 로드
- [ ] Premiere Pro 26.3+에서 패널 표시
- [ ] 일반 원본 클립으로 `호스트 자체시험` PASS
- [ ] 자체시험 뒤 내부 자산 0개
- [ ] 실제 Premiere 전사문 불러오기
- [ ] 새 러프컷 생성 및 원본 불변 확인
- [ ] 프레임 경계와 A/V sync 확인
- [ ] 저장·종료·재실행 후 새 시퀀스 확인
- [ ] 의도적 호스트 실패에서 rollback 확인
- [ ] Adobe UXP Developer Tool로 공식 CCX 패키징
- [ ] Creative Cloud 설치·업데이트·제거 확인

전 항목 통과 전에는 판매하거나 Stable/GA로 표시하지 않습니다.
