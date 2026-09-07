# Core 0.5.1 독립 배포 후보

## 산출물 구분

`*-uxp-source/`는 UXP Developer Tool에서 로드하는 소스 디렉터리입니다.

`*-premierepro.ccx`는 **POSIX 환경의 Info-ZIP 3.0**으로 만든 결정론적 독립 설치 후보입니다. 파일 타임스탬프, 권한과 파일 순서를 고정하고, 빌드 후 모든 entry를 source directory와 바이트 단위로 비교합니다.

Adobe는 일반적인 패키징에는 UXP Developer Tool의 **Package** 기능을 권장합니다. 이 저장소의 CCX 경로는 구조와 재현성을 로컬에서 검증하기 위한 제한된 경로입니다.

## 플랫폼별 검증

Linux, macOS, Windows에서는 공통으로 다음 소스 검증을 실행합니다.

```bash
npm ci
npm run verify
```

`npm run verify:distribution`은 결정론적 CCX 생성까지 포함하므로 POSIX Info-ZIP 3.0 환경에서만 실행합니다. Windows에서는 이 명령을 지원하지 않습니다.

교차 플랫폼 소스 재현성을 확인할 때는 각 플랫폼의 `*-uxp-source.manifest.json` 파일별 SHA-256을 비교합니다. CCX 재현성과 구조 검증은 같은 대상 커밋을 POSIX Info-ZIP 3.0 환경에서 빌드한 결과로 판정합니다.

## 설치 시험

1. 대상 커밋에서 `npm ci`와 `npm run verify`를 실행합니다.
2. POSIX Info-ZIP 3.0 환경에서 같은 커밋으로 `npm run verify:distribution`을 실행합니다.
3. 생성된 source manifest와 CCX manifest의 커밋, source tree SHA-256과 CCX SHA-256을 기록합니다.
4. 같은 실행에서 생성된 exact `.ccx`를 사용합니다.
5. Premiere를 한 번 실행한 뒤 종료합니다.
6. `.ccx`를 더블클릭하고 Creative Cloud Desktop에서 설치를 승인합니다.
7. Premiere의 UXP Plugins 메뉴에서 패널을 엽니다.
8. 플러그인 안의 실제 Premiere 검증 단계를 완료합니다.
9. Premiere를 실제로 종료·재실행하고 새 패널 세션의 구조 확인을 완료합니다.
10. 패널의 PASS 기록으로 qualification evidence를 생성합니다.
11. `npm run evidence:init-distribution -- <qualification-evidence> <previous-version> <outside-repo-workspace>`로 저장소 밖 검증 워크스페이스를 초기화합니다.
12. 초기 `distribution-verification.json`이 exact identity/hash만 채워지고 `sellerAttested: false`, 세 이벤트 `PENDING`인지 확인합니다.
13. 동일 plugin ID의 이전 시험 버전에서 현재 Core 0.5.1 후보로 업데이트 설치를 확인하고 `update/`에 증거를 보관합니다.
14. Creative Cloud Desktop의 Manage Plugins에서 현재 후보를 제거하고 패널 미노출·잔여 플러그인 데이터를 확인한 뒤 `removal/`에 증거를 보관합니다.
15. 설치·업데이트·제거의 실제 완료 시각·관찰 결과·상대 증거 파일만 생성된 JSON에 반영하고 모든 검증 뒤에만 `sellerAttested: true`로 변경합니다.
16. actual CCX와 qualification evidence를 함께 사용해 final distribution evidence를 생성합니다.

설치 실패 시 Creative Cloud Desktop의 오류 Details를 보존합니다. 사용자가 직접 UPIA 명령이나 시스템 폴더 삭제를 수행하도록 요구하지 않습니다.

Final distribution evidence 입력 형식과 명령은 [`DISTRIBUTION_EVIDENCE_KO.md`](DISTRIBUTION_EVIDENCE_KO.md)를 따릅니다. 초기화기는 qualification evidence의 plugin ID·버전·Git commit·CCX SHA-256을 자동 복사하고 저장소 안 경로 또는 비어 있지 않은 워크스페이스를 거부합니다. Final evidence 도구는 actual CCX를 다시 SHA-256으로 계산하고 설치·업데이트·제거 증거 파일도 각각 SHA-256으로 고정합니다.

## 판정 경계

CCX 구조 검증 PASS는 Creative Cloud 설치 PASS가 아닙니다. Qualification evidence PASS도 설치·업데이트·제거 PASS가 아닙니다. 초기화된 distribution verification workspace 역시 실제 검증 전에는 모두 PENDING입니다.

이 저장소가 정의한 모든 실제 게이트와 증거 파일을 통과해 final distribution evidence의 `releaseReady: true`가 생성된 경우에만 판매자 내부 배포 자격검증이 완료된 것으로 판정합니다. 이 값은 판매자가 수행한 수동 검증 완료를 의미하며 Adobe가 evidence를 서명하거나 원격 attestation했다는 뜻은 아닙니다.

실제 증거가 생성·보관되기 전 현재 Core 0.5.1 상태는 계속 `Distribution Qualification Candidate`입니다.
