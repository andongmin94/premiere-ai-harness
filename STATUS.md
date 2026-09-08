# Development status

모든 변경은 `main` 하나에만 반영합니다.

## 현재 제품

`Premiere AI Harness Core 0.5.1 — Distribution Qualification Candidate`

Core 기능 구현은 code-freeze candidate 상태입니다. 실제 `npm run verify`, 결정론적 CCX 검증, 실제 Premiere/Creative Cloud qualification 증거를 모두 확보하기 전에는 배포 상태를 승격하지 않습니다.

로컬 검증 범위:

- 패널 DOM, UXP entrypoint, Premiere Pro 26.3 API 계약
- 파일 경로와 source in/out API를 확인할 수 있는 일반 원본 클립만 지원
- SRT·WebVTT·Adobe 중첩 JSON 전사문 파서
- 전사문 raw 입력·JSON 배열 폭·JSON 탐색량·segment/전체 텍스트량을 상한으로 제한하고 과대 입력 fail-closed
- Adobe segment에 완성된 text가 있으면 중첩 words 배열을 불필요하게 순회·재조합하지 않음
- 로컬 편집 플래너와 승인하지 않은 삭제 차단
- 인접·중첩 후보는 confidence를 서로 상속하지 않으며 동일 삭제 범위만 중복 제거
- 명시적 retake marker 직전의 0.6초 이하·4초 이내 완료문장에만 punctuation grace 적용
- 원본 시작·끝 무발화 구간은 preset threshold와 speech-side breathing room을 적용한 0.89 수동 검토 후보로 제안
- 같은 화자의 94% 이상 반복 발화 사이에 짧은 단일 filler가 낀 경우 앞 시도+filler를 0.89 수동 검토 후보로 제안
- 서로 다른 화자의 재촬영·필러·반복 발화 오탐 차단
- qualification provenance가 현재 편집안과 불일치하면 Apply 비활성화, 기존 qualification record가 있으면 중복 시작 차단
- 첫 qualification roughCut PASS 뒤 sequence identity와 created snapshot을 immutable하게 유지하고 reset 전 재생성·덮어쓰기 차단
- 프로젝트·원본·전사문 stale-state 차단
- 호스트·롤백 자체시험 직전 프로젝트·클립·길이·프레임레이트 재검증
- 자체시험 PASS 결과와 qualification 대상 원본의 식별자·타이밍 재대조
- 실제 Premiere 전사문 fingerprint와 qualification 러프컷 입력의 provenance 결합
- 붙여넣은 전사문 또는 변경된 Premiere 전사문으로 qualification 러프컷을 우회하는 경로 차단
- 저장된 qualification 단계 간 transcript·roughCut·playback·persistence 불변조건 재검증
- 프레임 안쪽 정렬과 사라지는 유지 구간 차단
- 첫 mutation 전에 원본 media path와 VIDEO·AUDIO in/out 상태 snapshot
- 서브클립 생성 후 원본 media path·VIDEO/AUDIO in/out 불변성 재검증
- 생성된 각 서브클립의 media path가 원본과 동일한지 독립 대조
- 생성된 각 서브클립의 VIDEO·AUDIO source in/out을 요청한 원본 start/end 프레임과 독립 대조
- source identity/in-out 불일치 또는 검증 API 부재 시 시퀀스 생성 전 fail-closed 및 생성 자산 롤백
- 생성 시퀀스 snapshot v3에 timeline 배치, subclip project-item source range, TrackItem source range를 함께 기록
- VIDEO/AUDIO TrackItem의 timeline·project source·track source 범위 불일치 차단
- 저장 전후와 새 패널 세션에서 project-item source drift와 TrackItem slip drift를 모두 검증
- snapshot v2 이하 기록은 호환 처리하지 않고 새 qualification을 요구
- 부분 mutation 뒤 이번 작업의 시퀀스·빈·서브클립 롤백
- 동일 이름의 기존 사용자 시퀀스 보존
- 호스트 자체시험 PASS 이후에만 의도된 실패 롤백 시험 허용
- 모든 pre-save qualification 단계 PASS 이후에만 프로젝트 저장 검증 허용
- 패널 부팅 및 핵심 사용자 흐름 모의시험
- 복잡도와 coverage 게이트
- Linux/macOS/Windows 교차 플랫폼 재현 소스 패키징
- 깨끗한 Git working tree의 exact commit을 CCX manifest에 기록
- POSIX Info-ZIP 3.0 기반 결정론적 CCX와 안전 경로·중복·암호화·CRC·소스 일치 검사
- source tree SHA-256·Git commit·CCX SHA-256·실제 Premiere qualification PASS를 qualification evidence JSON으로 결합
- qualification evidence 자체 SHA-256과 사후 변조 검증
- qualification evidence에서 저장소 밖 PENDING distribution verification workspace 자동 초기화
- 워크스페이스 초기화 시 plugin ID·버전·Git commit·CCX SHA-256 자동 채움과 기존 파일 덮어쓰기 차단
- actual CCX 파일 바이트와 qualification evidence의 CCX SHA-256 재대조
- Creative Cloud Desktop 설치·업데이트·제거 PASS와 단계별 증거 파일 SHA-256 결합
- final distribution evidence 자체 SHA-256과 사후 변조 검증

정확한 소스 검증 결과는 대상 커밋에서 `npm ci`와 `npm run verify`를 실행해 확인합니다. 결정론적 CCX 검증은 깨끗한 같은 커밋을 POSIX Info-ZIP 3.0 환경에서 `npm run verify:distribution`으로 실행하고, 생성된 manifest와 SHA-256 기록을 별도로 보관합니다.

실제 Premiere qualification이 PASS인 경우 패널의 기계 판독용 JSON을 보관한 뒤 `npm run evidence:qualification -- /path/to/qualification.json`으로 source manifest·CCX manifest와 결합합니다. 이 단계의 `releaseReady`는 항상 `false`입니다.

그 다음 `npm run evidence:init-distribution -- <qualification-evidence> <previous-version> <outside-repo-workspace>`로 저장소 밖 검증 워크스페이스를 초기화합니다. exact identity/hash만 자동 채워지고 `sellerAttested: false`, 설치·업데이트·제거는 모두 `PENDING`으로 시작합니다. 실제 검증 결과와 증거 파일을 채운 뒤에만 final distribution evidence를 생성합니다.

Creative Cloud Desktop에서 exact CCX 설치, 동일 plugin ID의 이전 시험 버전에서 현재 후보로 업데이트, 현재 후보 제거를 각각 증거 파일과 함께 확인한 뒤 `npm run evidence:distribution -- <qualification-evidence> <distribution-verification.json> <exact.ccx>`을 실행합니다. actual CCX와 모든 단계별 증거가 일치한 경우에만 final distribution evidence의 `releaseReady`가 `true`가 됩니다. 이 값은 Adobe 원격 attestation이 아니라 판매자가 직접 수행·보관한 수동 검증 게이트의 완료를 뜻합니다.

## 남은 실제 Adobe 게이트

코드는 아래 결과를 표현하고 검증할 수 있지만 **현재 저장소 자체에는 실제 수행 증거가 아직 없습니다.** 따라서 현재 제품 상태는 계속 `Distribution Qualification Candidate`입니다.

- Linux/macOS/Windows에서 exact code-freeze commit의 `npm ci` + `npm run verify` PASS와 source manifest SHA-256 대조
- POSIX Info-ZIP 3.0 환경에서 exact commit의 `npm run verify:distribution` PASS와 결정론적 CCX 보관
- Creative Cloud Desktop에서 exact CCX 설치
- Premiere Pro 26.3+ 패널 로드
- 실제 파일 기반 클립의 호스트·롤백 자체시험에서 원본 media path/in/out 불변성과 subclip media identity·VIDEO/AUDIO source in/out 대조 PASS
- 실제 Premiere transcript export와 fingerprint 결합 확인
- 서브클립 프레임 경계와 A/V sync 직접 재생 확인
- 원본 시퀀스와 원본 미디어 불변
- 프로젝트 저장, Premiere 실제 종료·재실행, 새 패널 세션에서 timeline + project-item source + TrackItem source snapshot v3 동일성 확인
- qualification evidence JSON 생성·보관
- 저장소 밖 distribution verification workspace 초기화
- 동일 ID의 이전 시험 버전에서 현재 후보로 업데이트 설치
- Creative Cloud Desktop에서 현재 후보 제거와 패널 미노출·잔여 데이터 확인
- final distribution evidence JSON의 `releaseReady: true` 확인·보관

전 항목을 판매자가 보관 가능한 증거로 통과하기 전에는 Public Beta, Stable, GA 또는 판매판으로 표시하지 않습니다.
