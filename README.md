# Premiere AI Harness

Premiere Pro 26.3+에서 **대사 중심 원본 클립의 러프컷을 안전하게 만드는 UXP 플러그인**입니다.

현재 `0.1.0`은 작동하는 최소 제품층에 집중합니다.

- 프로젝트 패널에서 일반 원본 클립 하나 선택
- 기존 Premiere 전사문 또는 SRT / WebVTT / 지원 JSON 분석
- 재촬영 신호, 긴 무음, 연속 필러, 인접 반복 발화 후보 제안
- 사용자가 각 후보를 승인·거절
- 원본 시퀀스를 수정하지 않고 하드 바운더리 서브클립으로 새 러프컷 시퀀스 생성
- Local-only: 네트워크, API 키, Node.js, Companion, FFmpeg 없음

## 개발 검증

```bash
npm run verify
```

이 명령은 문법·DOM·Adobe 26.3 API 계약, 단위시험, 결정론적 CCX 패키징과 ZIP 무결성을 검증합니다.

생성 파일:

```text
dist/PremiereAIHarness-Core-0.1.0.ccx
```

## 제품 경계

현재 Core는 멀티캠, B-roll, 모션 자막, 최종 믹싱, OpenAI/ChatGPT 연결을 포함하지 않습니다. 이 기능들은 Core가 실제 Premiere 호스트에서 검증된 뒤 순차적으로 추가합니다.

자세한 내용은 [`docs/STATUS.md`](docs/STATUS.md)와 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)를 참고하십시오.
