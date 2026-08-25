Premiere AI Harness Core 0.4.0 Host Qualification Candidate

Premiere Pro 26.3+용 로컬 검토형 러프컷 플러그인입니다.
원본 시퀀스를 수정하지 않고 선택한 원본 클립의 유지 구간으로 새 시퀀스를 만듭니다.

첫 사용:
1. 프로젝트 패널에서 일반 원본 클립 하나 선택
2. 호스트 자체시험 실행
3. 전사문 분석 및 삭제 후보 검토
4. 새 러프컷 생성

판매 전 실제 호스트 검증:
1. 현재 원본으로 검증 시작
2. 호스트 자체시험과 실패 롤백 자체시험
3. 실제 Premiere 전사문 불러오기
4. 러프컷 생성 후 A/V 싱크와 원본 불변 확인
5. 프로젝트 저장, Premiere 종료 및 재실행
6. 생성 시퀀스 유지 확인
7. 검증 기록 status PASS 확인

현재 범위:
- Premiere 전사문 또는 SRT/WebVTT/JSON
- 재촬영 신호, 긴 무음, 필러 연속, 인접 반복 후보
- 사용자 검토 후 hard-boundary subclip과 새 러프컷 시퀀스 생성
- 호스트 자체시험, 의도된 실패 롤백 시험, 검증 기록, 로컬 데이터 초기화
- 네트워크, API 키, 별도 Companion 없음

이 디렉터리는 unsigned UXP source입니다. Adobe UXP Developer Tool의 공식 패키징 전에는 설치용 CCX가 아닙니다.
