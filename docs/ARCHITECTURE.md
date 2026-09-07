# Architecture

## 실행 경계

```text
Premiere UXP panel
  ├─ panel controller
  ├─ editor session state
  ├─ host certification
  ├─ qualification record
  ├─ host qualification flow
  ├─ transcript parser
  ├─ deterministic local planner
  ├─ review UI
  └─ Premiere adapter
       ├─ selected source verification
       ├─ frame-safe keep ranges
       ├─ hard-boundary subclips
       ├─ isolated output bin
       ├─ new sequence creation
       ├─ sequence structure snapshot
       ├─ save and later-session verification
       └─ failure cleanup
```

Core 0.5.1 플러그인은 외부 프로세스, localhost 서비스, 네트워크 API를 사용하지 않습니다.

## 모듈 책임

```text
index.js
  패널 lifecycle과 상위 흐름 연결

session-state.js
  선택 원본·전사문·편집안·busy 상태

transcript.js / planner.js
  입력 정규화와 결정론적 삭제 후보 계산

host-certification.js
  호스트 환경 지문과 자체시험 인증

qualification-record.js
  엄격한 검증 기록 스키마와 저장소 경계

host-qualification.js
  단계 전이와 검증 불변조건

qualification-flow.js
  패널 세션을 넘는 검증 단계 조정

premiere-runtime.js
  선택·식별자·시간·프레임·transaction 원시 기능

sequence-snapshot.js
  시퀀스 종료 시간·트랙·클립·경계의 정규화된 구조 기록

generated-assets.js
  빈·서브클립·시퀀스 생성

generated-cleanup.js
  부분 실패 rollback과 내부 시험 자산 정리

premiere-adapter.js
  실제 편집·호스트 자체시험·저장·후속 세션 확인

editor-flow.js / ui-view.js
  편집 작업 조정과 DOM 렌더링
```

각 모듈은 런타임 상태, Premiere mutation, 검증 기록, DOM을 서로 직접 섞지 않습니다. 기능이 없는 추상 계층이나 구버전 호환 계층은 두지 않습니다.

## 호스트 자체시험

사용자가 검사한 일반 원본 클립의 짧은 프레임 구간으로 다음을 수행합니다.

```text
현재 Premiere 프로젝트·클립 ID·길이·프레임레이트 재검증
→ 내부 전용 빈 생성
→ hard-boundary subclip 생성
→ 내부 시험 시퀀스 생성
→ 트랙·클립·경계 확인
→ 시험 시퀀스 삭제
→ 시험 subclip 및 빈 삭제
→ 기존 활성 시퀀스 복원
→ 잔여물이 없는지 재확인
```

원본 검증은 첫 mutation 전에 끝나야 하며, 검사 이후 프로젝트 패널 선택이 바뀌었거나 기대한 식별자를 호스트에서 더 이상 읽지 못하면 자체시험을 시작하지 않습니다. PASS 결과에는 실제 시험한 프로젝트 ID·클립 ID·길이·프레임레이트를 포함하고, qualification 기록에 반영할 때 저장된 검증 대상과 다시 대조합니다.

의도된 실패 롤백 시험은 같은 원본의 호스트 자체시험 PASS 뒤에만 실행합니다. 모든 단계와 정리가 통과한 경우에만 해당 검증 단계를 PASS로 기록합니다.

## 영속 검증

프로젝트 저장 준비는 호스트 자체시험, 실패 롤백 시험, 실제 Premiere 전사문, 러프컷 생성, 사용자의 재생 확인이 모두 PASS인 경우에만 허용합니다.

```text
러프컷 생성 직후 구조 기록
→ 사용자의 A/V 싱크·원본 불변 확인
→ 모든 pre-save qualification 단계 PASS 확인
→ project.save() 성공 확인
→ 저장 전후 구조 동일성 확인
→ 저장을 준비한 패널 세션 종료
→ 새 패널 세션에서 동일 프로젝트·시퀀스 ID 확인
→ 종료 시간·트랙·클립·경계의 완전 일치 확인
```

패널 세션 변경은 Premiere 프로세스 재시작 증거가 아닙니다. 실제 종료·재실행은 출시 체크리스트에서 별도로 확인합니다.

## 안전 원칙

1. 프로젝트 패널에서 원본 클립 하나만 허용합니다.
2. 오프라인·중첩·병합·멀티캠 원본은 mutation 전에 차단합니다.
3. 삭제 후보는 자동 적용하지 않고 사용자가 검토합니다.
4. 자동 선택 삭제량은 프리셋 상한 안에서만 선택합니다.
5. 실제 적용 전 동일 호스트 조합의 자체시험 PASS를 요구합니다.
6. 실제 편집과 자체시험 mutation 직전에 프로젝트·클립 ID·길이·프레임레이트를 재검증하며, Premiere 전사문을 사용한 편집은 전사문도 재검증합니다.
7. 기대한 프로젝트·클립 식별자를 호스트에서 읽지 못하는 경우도 stale-state 오류로 차단합니다.
8. 유지 구간은 원본 프레임 안쪽으로 정렬하며 사라지는 구간은 오류로 차단합니다.
9. 성공 출력은 `PAI_OUTPUT_` 전용 빈에 격리합니다.
10. 내부 시험 자산은 엄격한 `PAI_INTERNAL_*` 형식만 사용합니다.
11. 실패 시 이번 작업에서 생성한 ID 기준 자산만 정리하고, 이름만 같은 기존 자산은 건드리지 않습니다.
12. 정리 실패를 숨기지 않습니다.
13. 기존 시퀀스와 원본 미디어는 수정하지 않습니다.
14. 사용자가 생성 빈에 넣은 항목이 발견되면 보존하고 정리 실패를 보고합니다.
