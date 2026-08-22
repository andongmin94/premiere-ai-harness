# 실제 Premiere 최종 검증

이 문서는 **자동 검증 게이트가 모두 PASS한 뒤에만** 사용한다.

## 폐기된 방식

다음 파일과 절차는 더 이상 사용하지 않는다.

- 과거 대화에서 받은 PowerShell 자격검증 ZIP
- `Run-Field-Qualification.ps1`
- `Invoke-WebRequest`로 Node/FFmpeg/Codex를 받는 러너
- Inno Setup을 먼저 설치하는 검증 절차
- 직접 편집하는 `seller-config.json`

## 현재 검증 흐름

GitHub의 `main`에 있는 아래 영수증이 모두 PASS여야 한다.

- `reports/product-ci.json`
- `reports/offline-kit-ci.json`
- `reports/pre-premiere-e2e.json`
- `reports/host-gate-ci.json`
- `reports/automation-gates.json`

실제 Premiere 검증은 GitHub Actions의 **Premiere host qualification (verified gate)** 워크플로만 사용한다.

이 워크플로는 다음을 자동으로 수행한다.

1. GitHub Windows CI에서 이미 검증된 정확한 오프라인 키트 다운로드
2. 검증된 네이티브 HostGate 다운로드
3. 실제 Creative Cloud UPIA와 Premiere 설치 탐지
4. Studio CCX 설치
5. 주문형 Companion 시작
6. Premiere 실행
7. 사용자가 Premiere 패널에서 실제 기능 확인
8. PASS 또는 FAIL 신호 수집
9. 결과 ZIP 업로드
10. 러너가 만든 설치·프로세스·임시 파일만 정리

## 사용자에게 보이는 작업

Premiere가 열린 뒤 아래 항목을 수행한다.

- Host certification
- Local provider self-test
- 멀티캠
- 자동 B-roll
- MOGRT 자막
- 대사·BGM 믹싱
- 내보내기 및 렌더 QA
- 저장, 종료, 재실행
- 실패 롤백

모두 통과하면 바탕화면의 다음 파일을 실행한다.

```text
PAI-MARK-HOST-TEST-PASS.cmd
```

실패하면 다음 파일을 실행한다.

```text
PAI-MARK-HOST-TEST-FAIL.cmd
```

## 중요한 실행 조건

- 저장소는 private 상태를 유지한다.
- 브랜치는 `main` 하나만 사용한다.
- Self-hosted runner는 Windows 서비스로 설치하지 않는다.
- Adobe에 로그인된 사용자 데스크톱에서 `run.cmd`로만 시작한다.
- 외부 PR이나 포크의 워크플로는 실행하지 않는다.

## 정리 범위

워크플로는 자신이 다운로드·설치·생성한 항목만 제거한다.

- Studio 테스트 설치
- Companion 프로세스
- 테스트 CCX
- 작업 폴더
- 바탕화면 PASS/FAIL 신호 파일

다음은 삭제하지 않는다.

- Creative Cloud
- Premiere Pro
- 다른 Adobe 플러그인
- 다른 프로젝트
- Premiere 공용 Media Cache
- 사용자가 지정한 원본 영상
