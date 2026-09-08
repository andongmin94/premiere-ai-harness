# Core 0.5.1 배포 자격검증 체크리스트

## exact 커밋 로컬 게이트

- [ ] Git working tree가 깨끗한 대상 커밋인지 확인
- [ ] Linux / macOS / Windows에서 같은 대상 커밋으로 `npm ci`와 `npm run verify` 성공
- [ ] 패널 부팅·핵심 흐름 모의시험 성공
- [ ] 부분 mutation rollback 시험 성공
- [ ] 전사·플래너·snapshot v3·qualification 상태 회귀시험 성공
- [ ] coverage와 모듈 복잡도 예산 통과
- [ ] Linux / macOS / Windows source manifest의 파일별 SHA-256 일치
- [ ] POSIX Info-ZIP 3.0 환경에서 결정론적 CCX 2회 빌드 바이트 일치
- [ ] CCX manifest의 `sourceCommit`이 대상 Git commit과 일치
- [ ] CCX manifest 루트, 안전 경로, 중복 없음
- [ ] 암호화·ZIP data descriptor·숨은 바이트 없음
- [ ] CCX CRC와 source directory 파일별 바이트 일치
- [ ] source manifest와 CCX manifest가 대상 커밋·SHA-256 기록과 일치

## 실제 Premiere qualification 게이트

- [ ] 보관한 대상 커밋과 CCX SHA-256 기록 확인
- [ ] exact CCX를 Creative Cloud Desktop으로 설치 성공
- [ ] Premiere Pro 26.3+에서 패널 표시
- [ ] 파일 경로와 source in/out을 읽을 수 있는 일반 원본 클립 선택
- [ ] `호스트 자체시험`에서 원본 media path와 VIDEO/AUDIO in/out 불변 확인
- [ ] `호스트 자체시험`에서 generated subclip media identity가 원본과 동일함을 확인
- [ ] `호스트 자체시험`에서 generated subclip VIDEO/AUDIO source in/out이 요청 프레임과 정확히 일치
- [ ] `실패 롤백 자체시험` PASS와 내부 시험 자산 0개 확인
- [ ] 실제 Premiere 전사문 불러오기와 transcript fingerprint 기록
- [ ] 같은 Premiere transcript fingerprint로 qualification 러프컷 1회 생성
- [ ] 첫 qualification roughCut PASS 뒤 Apply가 잠기고, 다른 러프컷으로 바꾸려면 qualification reset이 필요함을 확인
- [ ] 러프컷 직접 재생으로 프레임 경계와 A/V sync 확인
- [ ] 원본 project item과 원본 미디어가 수정되지 않았음을 확인
- [ ] 저장 직전 snapshot v3의 timeline start/end, projectItem ID/name, VIDEO/AUDIO `projectSourceIn/Out`, `trackSourceIn/Out` 기록 확인
- [ ] 프로젝트 저장 성공
- [ ] 저장 직후 snapshot v3가 생성 직후 snapshot과 동일함을 확인
- [ ] Premiere 실제 종료·재실행
- [ ] 새 패널 세션에서 동일 project/sequence ID를 다시 찾음
- [ ] 새 패널 세션에서 timeline + project source + TrackItem source snapshot v3 완전 일치 PASS
- [ ] 패널의 기계 판독용 PASS 기록을 JSON으로 보관
- [ ] `npm run evidence:qualification -- /path/to/qualification.json` 성공
- [ ] qualification evidence의 source tree SHA-256·Git commit·CCX SHA-256·host qualification PASS 결합 확인
- [ ] qualification evidence가 created/persistence snapshot v3와 동일 source ranges를 포함하는지 확인
- [ ] qualification evidence의 `releaseReady`가 `false`인지 확인

## Creative Cloud 배포 게이트

- [ ] `npm run evidence:init-distribution -- <qualification-evidence> <previous-version> <outside-repo-workspace>` 성공
- [ ] 생성된 workspace가 저장소 밖에 있고 기존 파일을 덮어쓰지 않았는지 확인
- [ ] 생성된 `distribution-verification.json`의 plugin ID·버전·sourceCommit·ccxSha256이 qualification evidence와 자동 일치
- [ ] 초기 `sellerAttested`가 `false`인지 확인
- [ ] 초기 install/update/removal 상태가 모두 `PENDING`인지 확인
- [ ] 현재 후보 exact CCX 설치 성공 증거 파일을 `install/` 아래 보관
- [ ] 동일 plugin ID의 이전 시험 버전에서 현재 Core 0.5.1 후보로 업데이트 설치 성공
- [ ] 업데이트 뒤 Premiere 패널 정상 표시 증거 파일을 `update/` 아래 보관
- [ ] Creative Cloud Desktop에서 현재 Core 0.5.1 후보 제거 성공
- [ ] 제거 뒤 Premiere에서 패널 미노출 확인
- [ ] 프로젝트 결과물 외 플러그인 전용 잔여 데이터가 없음을 확인
- [ ] 제거 증거 파일을 `removal/` 아래 보관
- [ ] 설치·업데이트·제거 각각 최소 1개의 증거 파일 보관
- [ ] 실제 완료 시각·관찰 결과·상대 `evidenceFiles`만 생성된 `distribution-verification.json`에 반영
- [ ] 세 실제 검증을 모두 끝낸 뒤에만 `sellerAttested: true`로 변경
- [ ] `distribution-verification.json`의 `sourceCommit`과 `ccxSha256`을 수동으로 바꾸지 않았는지 확인
- [ ] `npm run evidence:distribution -- <qualification-evidence> <distribution-verification.json> <exact.ccx>` 성공
- [ ] final distribution evidence의 actual CCX SHA-256이 qualification evidence와 일치
- [ ] 설치·업데이트·제거 증거 파일의 SHA-256이 final distribution evidence에 기록됨
- [ ] final distribution evidence의 `adobeAttestation`이 `false`인지 확인
- [ ] final distribution evidence의 `releaseReady`가 `true`인지 확인
- [ ] final distribution evidence와 원본 증거 파일을 exact CCX와 함께 저장소 밖에 보관

Qualification evidence는 source/CCX/실제 Premiere 검증을 묶고 항상 `releaseReady: false`입니다. 초기화된 distribution verification workspace도 모든 실제 검증이 끝나기 전에는 PENDING 상태입니다. Final distribution evidence는 actual CCX와 판매자가 직접 수행한 Creative Cloud 설치·업데이트·제거 증거까지 모두 일치한 경우에만 `releaseReady: true`가 됩니다.

패널 세션 변경만으로 Premiere 프로세스 재시작을 증명하지는 않습니다. 위 qualification 게이트의 `Premiere 실제 종료·재실행`은 사람이 별도로 수행·확인해야 합니다.

`releaseReady: true`는 이 저장소가 정의한 판매자 검증 게이트의 완료를 뜻하며 Adobe가 evidence를 서명하거나 원격 attestation했다는 뜻은 아닙니다.

전 항목 통과 전에는 판매하거나 Public Beta, Stable, GA로 표시하지 않습니다.
