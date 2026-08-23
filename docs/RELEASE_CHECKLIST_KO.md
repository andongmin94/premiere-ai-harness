# 공개 베타 출시 체크리스트

## 코드 게이트

- [x] `npm run verify`
- [x] Ubuntu / Windows GitHub-hosted CI
- [x] 결정론적 CCX와 SHA-256 manifest
- [x] 외부 프로세스·네트워크 권한 없음
- [x] 자체시험 정리까지 PASS해야 실제 적용 활성화

## 판매자가 실제 Premiere에서 한 번 확인할 항목

- [ ] Creative Cloud Desktop에서 exact CCX 설치
- [ ] Premiere Pro 26.3+에서 패널 로드
- [ ] 일반 원본 클립을 선택하고 `호스트 자체시험` PASS
- [ ] 자체시험 뒤 `PAI_INTERNAL_SELFTEST_` 자산 0개
- [ ] Premiere 전사문 불러오기
- [ ] 새 러프컷 생성 및 원본 시퀀스 불변 확인
- [ ] 프로젝트 저장·종료·재실행 후 새 시퀀스 확인
- [ ] 의도된 실패에서 출력 빈·서브클립 자동 정리 확인
- [ ] 플러그인 데이터 초기화와 Creative Cloud 제거 확인

위 실기기 항목을 통과하기 전의 정확한 판매 라벨은 `Core 0.2.0 Public Beta`입니다. Stable/GA 또는 무인 완성편집기로 광고하지 않습니다.
