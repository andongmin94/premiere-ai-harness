# Premiere AI Harness

Premiere Pro 26.3+에서 대사 중심 원본 클립의 **검토형 러프컷**을 만드는 로컬 UXP 플러그인입니다.

현재 버전은 **Core 0.4.0 — Host Qualification Candidate**입니다.

## 현재 범위

- 프로젝트 패널의 일반 원본 클립 하나 선택
- Premiere 전사문 또는 SRT / WebVTT / 지원 JSON 분석
- 재촬영 신호, 긴 무음, 연속 필러, 인접 반복 발화 후보 제안
- 사용자 승인·거절 후 새 하드 바운더리 서브클립과 새 시퀀스 생성
- 프로젝트·클립·길이·프레임레이트·Premiere 전사문 재검증
- 부분 실패 시 생성 시퀀스·서브클립·빈 롤백
- 실제 Premiere 환경의 호스트 자체시험과 의도된 실패 롤백 시험
- 실제 전사문·러프컷·A/V 싱크·저장 후 재실행을 묶은 영속 검증 기록
- 네트워크, API 키, Companion, FFmpeg, 백그라운드 서비스 없음

## 개발 검증

```bash
npm ci
npm run verify
```

`verify`는 문법·DOM 계약·Adobe API 계약·복잡도 예산·coverage 게이트·단위/통합/실패 주입 시험·결정론적 source package 검사를 수행합니다.

GitHub Actions는 Linux와 Windows에서 각각 같은 검증을 실행하고, 두 운영체제가 생성한 source directory의 파일별 SHA-256과 tree SHA-256이 일치해야 PASS 영수증을 기록합니다.

## 빌드 결과

```text
dist/PremiereAIHarness-Core-0.4.0-uxp-source/
dist/PremiereAIHarness-Core-0.4.0-uxp-source.manifest.json
```

이 결과는 **설치용 CCX가 아니라 Adobe UXP Developer Tool에 로드할 검증된 unsigned source directory**입니다. 공식 CCX 패키징과 실제 Premiere 호스트 검증 전에는 배포판으로 취급하지 않습니다.

## 실제 호스트 검증 흐름

```text
원본 검사
→ 실제 Premiere 검증 시작
→ 호스트 자체시험
→ 실패 롤백 자체시험
→ Premiere 전사문 불러오기
→ 러프컷 생성
→ A/V 싱크·원본 불변 확인
→ 프로젝트 저장·Premiere 종료·재실행
→ 생성 시퀀스 유지 확인
```

검증 기록은 전사문 본문이나 미디어를 저장하지 않고, 호스트 지문·원본 식별자·단계별 PASS와 생성 시퀀스 식별자만 플러그인 전용 localStorage 키에 보관합니다.

## 제품 경계

현재 Core에는 멀티캠, 자동 B-roll, 모션 자막, 최종 오디오 믹싱, OpenAI/ChatGPT 연결, 무인 완성편집이 포함되지 않습니다.

상세 상태는 [`STATUS.md`](STATUS.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/RELEASE_CHECKLIST_KO.md`](docs/RELEASE_CHECKLIST_KO.md)를 참고하십시오.
