# Core 0.5.1 최종 배포 증거

`qualification evidence`는 source tree, exact Git commit, CCX, 실제 Premiere qualification PASS를 묶습니다. `distribution evidence`는 여기에 Creative Cloud Desktop 설치·업데이트·제거의 판매자 보관 증거를 추가합니다.

이 저장소가 만드는 최종 evidence는 **Adobe가 서명한 attestation이 아니라 판매자가 직접 수행·보관하는 수동 검증 기록**입니다.

## 1. qualification evidence 준비

실제 Premiere 검증이 PASS인 기계 판독 JSON을 보관하고 다음을 실행합니다.

```bash
npm run evidence:qualification -- /path/to/qualification.json
```

결과 예:

```text
dist/PremiereAIHarness-Core-0.5.1-qualification-evidence.json
```

## 2. 검증 워크스페이스 초기화

`distribution-verification.json`을 처음부터 손으로 작성하지 않습니다. qualification evidence에서 plugin ID, 후보 버전, exact Git commit, CCX SHA-256을 읽어 저장소 밖에 안전한 초안을 생성합니다.

```bash
npm run evidence:init-distribution -- \
  /path/to/PremiereAIHarness-Core-0.5.1-qualification-evidence.json \
  0.5.0 \
  /outside/repository/pai-0.5.1-distribution-verification
```

두 번째 인자는 동일 plugin ID로 업데이트 시험할 이전 버전입니다. 현재 후보보다 낮은 semver여야 합니다. 마지막 인자는 반드시 저장소 바깥의 비어 있는 경로여야 하며, 기존 파일이 있으면 초기화기는 덮어쓰지 않습니다.

생성 결과:

```text
pai-0.5.1-distribution-verification/
  distribution-verification.json
  README.txt
  install/
  update/
  removal/
```

초기 JSON은 identity/hash만 qualification evidence에서 자동 채웁니다. 검증 결과는 미리 통과시키지 않습니다.

```json
{
  "sellerAttested": false,
  "events": {
    "install": { "status": "PENDING", "evidenceFiles": [] },
    "update": { "status": "PENDING", "evidenceFiles": [] },
    "removal": { "status": "PENDING", "evidenceFiles": [] }
  }
}
```

초기화기는 변조된 qualification evidence를 거부하고, 증거 워크스페이스가 저장소 안에 만들어지는 것도 거부합니다.

## 3. 실제 Creative Cloud 검증 결과 기록

각 실제 검증이 끝난 뒤 해당 폴더에 증거 파일을 넣고 생성된 `distribution-verification.json`의 관찰 결과만 갱신합니다. `evidenceFiles`는 JSON 파일이 있는 디렉터리 아래의 상대 경로만 허용합니다. 심볼릭 링크와 상위 디렉터리 탈출은 허용하지 않습니다.

완료된 형태 예시는 다음과 같습니다.

```json
{
  "formatVersion": 1,
  "evidenceKind": "premiere-ai-harness-creative-cloud-distribution-verification",
  "verificationId": "distribution-0.5.1-0123456789ab",
  "method": "creative-cloud-desktop",
  "sellerAttested": true,
  "pluginId": "com.andongmin.premiere-ai-harness.core",
  "version": "0.5.1",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "ccxSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "events": {
    "install": {
      "status": "PASS",
      "method": "creative-cloud-desktop",
      "completedAt": "2026-09-07T10:00:00+09:00",
      "version": "0.5.1",
      "panelVisible": true,
      "evidenceFiles": ["install/creative-cloud.png", "install/premiere-panel.png"]
    },
    "update": {
      "status": "PASS",
      "method": "creative-cloud-desktop",
      "completedAt": "2026-09-07T10:20:00+09:00",
      "fromVersion": "0.5.0",
      "toVersion": "0.5.1",
      "samePluginId": true,
      "panelVisible": true,
      "evidenceFiles": ["update/creative-cloud.png", "update/premiere-panel.png"]
    },
    "removal": {
      "status": "PASS",
      "method": "creative-cloud-desktop",
      "completedAt": "2026-09-07T10:40:00+09:00",
      "version": "0.5.1",
      "panelAbsent": true,
      "pluginOwnedResidualDataFound": false,
      "evidenceFiles": ["removal/creative-cloud.png", "removal/premiere-no-panel.png"]
    }
  }
}
```

`update.fromVersion`은 현재 후보보다 낮은 semver여야 하고 `update.toVersion`은 현재 후보 버전이어야 합니다. 즉 동일 plugin ID의 이전 시험 버전에서 현재 후보로 실제 업데이트 설치를 확인합니다. 같은 버전 재설치나 더 높은 버전에서 현재 후보로 내려오는 downgrade는 update PASS로 인정하지 않습니다.

각 단계는 증거 파일이 최소 1개 필요합니다. 파일 종류는 제한하지 않지만 일반 파일이어야 하며 파일당 50 MiB 이하, 단계당 최대 20개입니다. 최종 evidence에는 원본 파일을 복제하지 않고 상대 파일명·바이트 수·SHA-256만 기록합니다.

모든 실제 검증을 끝낸 뒤에만 `sellerAttested`를 `true`로 바꿉니다. 초기화된 `PENDING` 상태를 PASS처럼 취급하지 않습니다.

## 4. final distribution evidence 생성

qualification evidence, 초기화 후 실제 결과를 채운 검증 기록, 실제 설치에 사용한 exact CCX 파일을 함께 전달합니다.

```bash
npm run evidence:distribution -- \
  /path/to/PremiereAIHarness-Core-0.5.1-qualification-evidence.json \
  /outside/repository/pai-0.5.1-distribution-verification/distribution-verification.json \
  /path/to/PremiereAIHarness-Core-0.5.1-premierepro.ccx
```

기본 결과:

```text
dist/PremiereAIHarness-Core-0.5.1-distribution-evidence.json
```

도구는 actual CCX 바이트를 다시 SHA-256으로 계산해 qualification evidence의 CCX와 일치하는지 확인합니다. 설치·업데이트·제거가 모두 PASS이고 각 증거 파일을 읽어 SHA-256으로 고정한 경우에만 최종 evidence의 `releaseReady`가 `true`가 됩니다.

## 증거 의미

`releaseReady: true`는 이 저장소가 정의한 판매자 검증 게이트를 모두 충족했다는 뜻입니다. Adobe가 이 evidence에 서명하거나 원격으로 보증했다는 뜻은 아닙니다. 최종 JSON에는 이를 명시하기 위해 다음 값을 고정합니다.

```json
{
  "assurance": "seller-recorded-manual-distribution-verification",
  "adobeAttestation": false
}
```

최종 evidence 자체도 SHA-256을 포함하므로 생성 후 JSON 내용이 바뀌면 검증에 실패합니다. evidence와 원본 증거 파일은 배포한 exact CCX와 함께 저장소 밖의 판매자 보관 위치에 보존합니다.
