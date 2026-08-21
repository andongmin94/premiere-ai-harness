# Architecture

## 실행 경계

```text
Premiere UXP panel
  ├─ transcript parser
  ├─ deterministic local planner
  ├─ user review UI
  └─ Premiere adapter
       ├─ selected source verification
       ├─ frame-safe keep ranges
       ├─ hard-boundary subclips
       ├─ isolated generated bin
       ├─ new sequence creation
       └─ failure cleanup
```

Core 플러그인은 외부 프로세스, localhost 서비스, 네트워크 API를 사용하지 않습니다.

## 안전 원칙

1. 프로젝트 패널에서 원본 클립 하나만 허용합니다.
2. 오프라인·중첩·병합·멀티캠 원본은 mutation 전에 차단합니다.
3. 삭제 후보는 자동 적용하지 않고 사용자가 검토합니다.
4. 자동 선택 삭제량은 프리셋 상한 안에서만 선택합니다.
5. 적용 직전에 클립 ID·길이·프레임레이트를 재검증합니다.
6. 유지 구간은 원본 프레임 안쪽으로 정렬합니다.
7. 생성 자산은 고유한 `PAI_` 접두어와 전용 빈에 격리합니다.
8. 시퀀스 생성 실패 시 생성 서브클립과 빈을 정리합니다.
9. 기존 시퀀스와 원본 미디어는 수정하지 않습니다.
