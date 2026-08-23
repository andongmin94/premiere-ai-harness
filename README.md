# Premiere AI Harness

Premiere Pro 26.3+에서 **대사 중심 원본 클립의 검토형 러프컷을 안전하게 만드는 로컬 UXP 플러그인**입니다.

`0.2.0`은 공개 베타 후보인 Core 제품층입니다.

- 프로젝트 패널에서 일반 원본 클립 하나 선택
- 기존 Premiere 전사문 또는 SRT / WebVTT / 지원 JSON 분석
- 재촬영 신호, 긴 무음, 연속 필러, 인접 반복 발화 후보 제안
- 사용자가 각 후보를 승인·거절
- 원본 시퀀스를 수정하지 않고 새 하드 바운더리 러프컷 시퀀스 생성
- Premiere/UXP/플러그인/OS 조합별 일회성 호스트 자체시험
- 자체시험 임시 빈·서브클립·시퀀스의 생성·검증·완전 정리 확인
- 호스트 버전이나 플러그인 버전이 바뀌면 자동으로 재인증 요구
- Local-only: 네트워크, API 키, Node.js, Companion, FFmpeg 없음

## 개발 검증

```bash
npm ci
npm run verify
```

이 명령은 문법·DOM·Adobe 26.3 API 계약, 단위시험, 결정론적 CCX 패키징과 ZIP 무결성을 검증합니다.

생성 파일:

```text
dist/PremiereAIHarness-Core-0.2.0.ccx
```

## 사용자 흐름

```text
CCX 설치
→ 프로젝트 패널에서 원본 클립 하나 선택
→ 호스트 자체시험 1회
→ 전사문 분석
→ 삭제 후보 검토
→ 새 러프컷 시퀀스 생성
```

호스트 자체시험은 임시 자산을 만들고 다시 삭제하며, 정리 확인까지 완료돼야 실제 편집 버튼이 활성화됩니다.

## 제품 경계

현재 Core는 멀티캠, 자동 B-roll, 모션 자막, 최종 믹싱, OpenAI/ChatGPT 연결을 포함하지 않습니다. 이 저장소는 과거의 Companion·FFmpeg·Codex 실험 경로를 제품 본체로 취급하지 않습니다.

자세한 내용은 [`docs/STATUS.md`](docs/STATUS.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/UNINSTALL_KO.md`](docs/UNINSTALL_KO.md)를 참고하십시오.
