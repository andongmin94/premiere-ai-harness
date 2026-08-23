# Architecture

## 실행 경계

```text
Premiere UXP panel
  ├─ host environment fingerprint
  ├─ one-click host self-test
  ├─ transcript parser
  ├─ deterministic local planner
  ├─ user review UI
  └─ Premiere adapter
       ├─ selected source verification
       ├─ frame-safe keep ranges
       ├─ hard-boundary subclips
       ├─ isolated output bin
       ├─ new sequence creation
       ├─ postcondition verification
       └─ failure cleanup
```

Core 플러그인은 외부 프로세스, localhost 서비스, 네트워크 API를 사용하지 않습니다.

## 호스트 자체시험

사용자가 선택한 일반 원본 클립의 짧은 프레임 구간으로 다음을 수행합니다.

```text
내부 전용 빈 생성
→ hard-boundary subclip 생성
→ 내부 시험 시퀀스 생성
→ 활성화·재탐색 확인
→ 시험 시퀀스 삭제
→ 시험 subclip 및 빈 삭제
→ 기존 활성 시퀀스 복원
→ 잔여물이 없는지 재확인
```

모든 단계와 정리가 통과한 경우에만 Premiere/UXP/플러그인/OS 조합의 인증을 localStorage에 기록합니다. 어느 버전이든 바뀌면 인증은 자동 무효화됩니다.

## 안전 원칙

1. 프로젝트 패널에서 원본 클립 하나만 허용합니다.
2. 오프라인·중첩·병합·멀티캠 원본은 mutation 전에 차단합니다.
3. 삭제 후보는 자동 적용하지 않고 사용자가 검토합니다.
4. 자동 선택 삭제량은 프리셋 상한 안에서만 선택합니다.
5. 실제 적용 전 동일 호스트 조합의 자체시험 PASS를 요구합니다.
6. 적용 직전에 클립 ID·길이·프레임레이트와 Premiere 전사문을 재검증합니다.
7. 유지 구간은 원본 프레임 안쪽으로 정렬합니다.
8. 성공 출력은 `PAI_OUTPUT_` 전용 빈에 격리합니다.
9. 내부 시험 자산은 `PAI_INTERNAL_SELFTEST_` 접두어만 사용합니다.
10. 실패 시 생성 시퀀스·서브클립·빈을 정리하고, 정리 실패를 숨기지 않습니다.
11. 기존 시퀀스와 원본 미디어는 수정하지 않습니다.
12. 복구 정리는 내부 자체시험 접두어만 대상으로 하며 완성 출력은 삭제하지 않습니다.
