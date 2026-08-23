# Core 0.5.1 독립 배포 후보

## 산출물 구분

`*-uxp-source/`는 UXP Developer Tool에서 로드하는 소스 디렉터리입니다.

`*-premierepro.ccx`는 GitHub의 Linux runner 또는 로컬 Info-ZIP 3.0 환경에서 만든 독립 설치 후보입니다. 파일 타임스탬프, 권한과 파일 순서를 고정하고, 빌드 후 모든 entry를 source directory와 바이트 단위로 비교합니다.

Adobe는 일반적인 패키징에는 UXP Developer Tool의 **Package** 기능을 권장합니다. 이 저장소의 CCX 경로는 self-hosted runner 없이 구조와 재현성을 자동 검증하기 위한 제한된 경로입니다.

## 설치 시험

1. 대상 커밋의 `Product CI` 실행이 성공했는지 확인합니다.
2. `PremiereAIHarness-Core-Distribution-Receipt` 아티팩트의 커밋, source tree SHA-256과 CCX SHA-256을 확인합니다.
3. `PremiereAIHarness-Core-CCX-Candidate`에서 exact `.ccx`를 받습니다.
4. Premiere를 한 번 실행한 뒤 종료합니다.
5. `.ccx`를 더블클릭하고 Creative Cloud Desktop에서 설치를 승인합니다.
6. Premiere의 UXP Plugins 메뉴에서 패널을 엽니다.
7. 플러그인 안의 실제 Premiere 검증 단계를 완료합니다.
8. Premiere를 실제로 종료·재실행하고 새 패널 세션의 구조 확인을 완료합니다.
9. 같은 ID의 다음 시험 버전으로 업데이트 설치를 확인합니다.
10. Creative Cloud Desktop의 Manage Plugins에서 제거합니다.

설치 실패 시 Creative Cloud Desktop의 오류 Details를 보존합니다. 사용자가 직접 UPIA 명령이나 시스템 폴더 삭제를 수행하도록 요구하지 않습니다.

## 판정 경계

CCX 구조 검증 PASS는 Creative Cloud 설치 PASS가 아닙니다. 실제 설치·업데이트·제거와 Premiere 호스트 검증이 끝날 때까지 `Distribution Qualification Candidate`입니다.
