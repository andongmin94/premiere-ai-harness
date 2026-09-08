# Premiere AI Harness

Premiere Pro 26.3+에서 대사 중심 원본 클립의 **검토형 러프컷**을 만드는 로컬 UXP 플러그인입니다.

현재 버전은 **Core 0.5.1 — Distribution Qualification Candidate**입니다.

## 현재 범위

- 프로젝트 패널의 일반 원본 클립 하나 선택
- Premiere 전사문 또는 SRT / WebVTT / 지원 JSON 분석
- 재촬영 신호, 긴 무음, 연속 필러, 같은 화자의 반복 발화 후보 제안
- 사용자 승인·거절 후 새 하드 바운더리 서브클립과 새 시퀀스 생성
- 프로젝트·클립·길이·프레임레이트·Premiere 전사문 재검증
- 생성 subclip의 원본 media identity와 VIDEO/AUDIO source in/out 독립 검증
- 생성 시퀀스의 timeline 배치와 project-item/TrackItem source range 검증
- 부분 실패 시 이번 작업의 시퀀스·서브클립·빈 롤백
- 실제 Premiere 환경의 호스트 자체시험과 의도된 실패 롤백 시험
- 프로젝트 저장 전후와 새 패널 세션에서 snapshot v3의 timeline·project source·TrackItem source 완전 일치 확인
- qualification의 첫 PASS 러프컷은 검증 기록을 초기화하기 전까지 교체 불가
- 네트워크, API 키, Companion, FFmpeg, 백그라운드 서비스 없음

## 개발 검증

Linux, macOS, Windows의 소스 검증은 다음 명령을 사용합니다.

```bash
npm ci
npm run verify
```

결정론적 설치 후보 CCX 생성과 CCX 내부 검증은 **POSIX 환경의 Info-ZIP 3.0**을 요구합니다. CCX에 정확한 Git commit을 기록하기 위해 working tree가 깨끗해야 합니다.

```bash
npm run verify:distribution
```

교차 플랫폼 확인이 필요하면 Linux, macOS, Windows에서 같은 대상 커밋으로 `npm ci`와 `npm run verify`를 실행하고 생성된 source manifest의 파일별 SHA-256을 비교합니다. CCX 자체의 재현성 검증은 같은 검증 대상 커밋을 POSIX Info-ZIP 3.0 환경에서 빌드해 수행합니다. CCX 검증은 고정 타임스탬프와 정렬된 파일 순서를 사용하며, 중복·경로 탈출·암호화·ZIP data descriptor·숨은 바이트·CRC·소스 불일치를 차단합니다.

Windows에서는 `npm run verify:distribution`을 지원하지 않습니다. 일반적인 Windows 패키징이 필요하면 Adobe UXP Developer Tool의 Package 기능을 사용하고, 이 저장소가 정의한 결정론적 CCX 후보는 POSIX 빌드 결과를 사용합니다.

## 빌드 결과

```text
dist/PremiereAIHarness-Core-0.5.1-uxp-source/
dist/PremiereAIHarness-Core-0.5.1-uxp-source.manifest.json
dist/PremiereAIHarness-Core-0.5.1-premierepro.ccx
dist/PremiereAIHarness-Core-0.5.1-premierepro.ccx.sha256
dist/PremiereAIHarness-Core-0.5.1-premierepro.ccx.manifest.json
```

`.ccx`는 manifest를 루트에 둔 ZIP 설치 후보입니다. **Creative Cloud Desktop 실제 설치·업데이트·제거와 실제 Premiere 검증을 아직 통과하지 않았으므로 배포판이나 판매판으로 취급하지 않습니다.** 일반 패키징에는 Adobe UXP Developer Tool의 Package 기능을 사용할 수 있습니다.

## Qualification evidence

실제 Premiere 검증이 `PASS`가 되면 패널의 기계 판독용 검증 기록을 JSON 파일로 보관합니다. 그 파일을 같은 커밋에서 만든 source manifest·CCX manifest와 결합할 수 있습니다.

```bash
npm run evidence:qualification -- /path/to/qualification.json
```

기본 입력은 현재 버전의 `dist/*-uxp-source.manifest.json`과 `dist/*-premierepro.ccx.manifest.json`입니다. 결과는 다음 파일입니다.

```text
dist/PremiereAIHarness-Core-0.5.1-qualification-evidence.json
```

Evidence builder는 입력 qualification의 created/persistence snapshot v3 구조와 source ranges가 유효하고 서로 동일한지 먼저 검증합니다. 출력 evidence에는 snapshot 원문 대신 qualification record SHA-256, source tree SHA-256, exact Git commit, CCX SHA-256, 호스트 환경 fingerprint, Premiere transcript fingerprint와 persistence 식별자를 기록하고 자체 SHA-256을 갖습니다. 프로젝트·클립 이름이나 원문 transcript를 별도로 복제하지 않습니다.

Qualification에서 첫 러프컷이 PASS로 기록되면 해당 sequence identity와 생성 snapshot은 검증 기록을 초기화하기 전까지 교체할 수 없습니다. 다른 러프컷으로 다시 검증하려면 qualification을 명시적으로 초기화하고 처음부터 진행해야 합니다.

이 파일은 **qualification evidence candidate**일 뿐이며 `releaseReady`는 항상 `false`입니다. Creative Cloud 실제 설치·업데이트·제거 증거는 별도 실제 Adobe 게이트이므로 이 파일만으로 판매판이나 GA를 주장하지 않습니다.

## Distribution verification workspace

`distribution-verification.json`의 plugin ID, 버전, Git commit, CCX SHA-256을 손으로 복사하지 않도록 qualification evidence에서 검증 워크스페이스를 초기화할 수 있습니다.

```bash
npm run evidence:init-distribution -- \
  /path/to/PremiereAIHarness-Core-0.5.1-qualification-evidence.json \
  0.5.0 \
  /outside/repository/pai-0.5.1-distribution-verification
```

두 번째 인자는 현재 후보로 업데이트할 **이전 시험 버전**이고, 마지막 인자는 반드시 저장소 바깥의 비어 있는 경로여야 합니다. 초기화기는 다음을 생성합니다.

```text
pai-0.5.1-distribution-verification/
  distribution-verification.json
  README.txt
  install/
  update/
  removal/
```

초안은 exact identity/hash만 자동 채우고 `sellerAttested: false`, 세 이벤트 `status: PENDING`, 증거 파일 목록은 빈 배열로 둡니다. 실제 검증 전에 PASS가 미리 기록되지는 않습니다. 각 실제 검증이 끝날 때 해당 폴더에 증거 파일을 넣고 관찰 결과만 JSON에 반영합니다.

## Final distribution evidence

Creative Cloud Desktop에서 exact CCX의 설치, 동일 plugin ID의 이전 시험 버전에서 현재 후보로 업데이트, 현재 후보 제거까지 실제로 확인한 뒤 초기화된 `distribution-verification.json`과 각 단계의 증거 파일을 사용합니다.

```bash
npm run evidence:distribution -- \
  /path/to/PremiereAIHarness-Core-0.5.1-qualification-evidence.json \
  /outside/repository/pai-0.5.1-distribution-verification/distribution-verification.json \
  /path/to/PremiereAIHarness-Core-0.5.1-premierepro.ccx
```

도구는 actual CCX 파일 바이트를 다시 해시하고, 설치·업데이트·제거의 PASS 상태와 증거 파일 존재 여부·SHA-256을 검증합니다. 모든 항목이 일치한 경우에만 다음 파일의 `releaseReady`가 `true`가 됩니다.

```text
dist/PremiereAIHarness-Core-0.5.1-distribution-evidence.json
```

이 최종 evidence는 **판매자가 직접 수행·보관하는 수동 검증 기록**이며 Adobe가 서명한 attestation은 아닙니다. 결과에는 `adobeAttestation: false`가 고정됩니다. 입력 JSON 형식과 증거 파일 규칙은 [`docs/DISTRIBUTION_EVIDENCE_KO.md`](docs/DISTRIBUTION_EVIDENCE_KO.md)를 참고하십시오.

## 실제 호스트·설치 검증 흐름

```text
깨끗한 검증 대상 커밋에서 source tree SHA-256·CCX SHA-256·Git commit 기록
→ Creative Cloud Desktop으로 exact CCX 설치
→ Premiere에서 패널 열기
→ 파일 기반 일반 원본 검사 및 실제 Premiere 검증 시작
→ 호스트 자체시험: 원본 media path/in/out 불변 + generated subclip media identity/source range 확인
→ 실패 롤백 자체시험
→ Premiere 전사문 불러오기와 fingerprint 기록
→ 같은 fingerprint로 qualification 러프컷 1회 생성
→ A/V 싱크·프레임 경계·원본 불변 직접 확인
→ 프로젝트 저장과 snapshot v3 기록
→ Premiere 실제 종료·재실행
→ 새 패널 세션에서 동일 sequence ID와 timeline/projectSource/trackSource snapshot v3 일치 확인
→ qualification evidence JSON 생성·보관
→ 저장소 밖 distribution verification workspace 초기화
→ 동일 ID의 이전 시험 버전에서 현재 후보로 업데이트 설치 확인
→ 현재 후보 제거와 패널 미노출·잔여 플러그인 데이터 확인
→ final distribution evidence JSON 생성·보관
```

플러그인은 프로젝트 저장 성공과 **새 패널 세션**에서 snapshot v3가 동일한지를 검증합니다. 패널 세션 변경 자체는 Premiere 프로세스 재시작 증거가 아니므로, **Premiere 실제 종료·재실행은 사람이 체크리스트에서 별도로 확인**해야 합니다.

## 제품 경계

현재 Core에는 멀티캠, 자동 B-roll, 모션 자막, 최종 오디오 믹싱, OpenAI/ChatGPT 연결, 무인 완성편집이 포함되지 않습니다.

상세 상태는 [`STATUS.md`](STATUS.md), [`docs/DISTRIBUTION_KO.md`](docs/DISTRIBUTION_KO.md), [`docs/DISTRIBUTION_EVIDENCE_KO.md`](docs/DISTRIBUTION_EVIDENCE_KO.md), [`docs/RELEASE_CHECKLIST_KO.md`](docs/RELEASE_CHECKLIST_KO.md)를 참고하십시오.
