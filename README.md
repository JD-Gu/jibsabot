# jibsabot

주식회사 에이치앤아이(H&I) **구대표집사봇** — Slack에서 동작하는 대표 전용 AI 비서(Vercel 서버리스).

## 문서

- **[기획서.md](./기획서.md)** — 4대 역할·채널 35개 매핑·권한·로드맵·**현재 구현 대비** 정리

## 구현 개요 (v15.6)

- `api/slack.js`: Slack Events 수신 → 서명 검증 → `BOSS_USER_ID` 일치 시 Gemini + `report_management_status`(`#cmm-cxo`, `#cmm-영업지원`, `#noti-업무일정`) / `send_message`
- Google Calendar: 서비스 계정 JWT **읽기 전용**

## 환경 변수 (Vercel)

`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `BOSS_USER_ID`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`

자세한 설명은 기획서 §8·§10.2 참고.

## 배포

GitHub 연동 후 Vercel에 프로젝트 연결. Slack 앱의 Event Subscriptions URL을 배포 URL의 `/api/slack`에 맞춥니다.
