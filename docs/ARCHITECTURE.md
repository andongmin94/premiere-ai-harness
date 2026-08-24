# Architecture — Core 0.3.1

```text
Premiere UXP panel
  ├─ index.js                 사용자 흐름 orchestration
  ├─ ui-view.js               DOM 표시·컨트롤 상태
  ├─ session-state.js         선택·전사·편집안 상태
  ├─ host-certification.js    호스트 지문·인증 저장
  ├─ transcript.js            SRT / VTT / JSON 파싱
  ├─ planner.js               후보 탐지·승인 안전 규칙
  ├─ premiere-runtime.js      선택·프레임·transaction primitives
  ├─ generated-assets.js      빈·서브클립·시퀀스 생성
  ├─ generated-cleanup.js     rollback·복구 정리
  └─ premiere-adapter.js      Premiere use-case orchestration
```

## 안전 경계

1. 일반 원본 클립 하나만 허용합니다.
2. 실제 mutation 전에 프로젝트·클립·길이·fps·Premiere 전사문을 재검증합니다.
3. 삭제 후보는 사용자가 검토합니다.
4. 삭제 상한과 최소 유지 구간을 위반하면 적용을 중단합니다.
5. 프레임 정렬로 유지 구간이 사라지면 적용을 중단합니다.
6. 결과는 고유한 `PAI_OUTPUT_` 빈과 새 시퀀스에 격리합니다.
7. 시퀀스 생성 후 호스트가 실패해도 exact unique name으로 다시 찾아 롤백합니다.
8. 생성 빈에 사용자 항목이 있으면 그 항목과 빈을 보존하고 정리 실패를 알립니다.
9. 자체시험 복구는 엄격한 `PAI_INTERNAL_SELFTEST_...` 형식만 대상으로 합니다.
10. 기존 시퀀스와 원본 미디어는 수정하지 않습니다.

Core는 외부 프로세스, localhost 서비스, 네트워크 권한을 사용하지 않습니다.
