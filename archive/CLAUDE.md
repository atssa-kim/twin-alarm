# TwinTower Ops — 프로젝트 컨텍스트

> 이 파일은 핵심 현재 상태만 200줄 이내로 유지합니다. 상세 변경 이력·설계 배경(작업 로그,
> duty_matrix 신설 배경 등)은 [history.md](./history.md) 참고.

## 앱 개요
트윈타워 빌딩 재난 대응 실시간 협업 시스템.
- **지휘관**: 재난 발령, 대원 현황 모니터링
- **대원**: 나의 임무 체크리스트 실시간 확인/수행
- **COP**: 전체 상황판 조회

## 기술 스택
- React 19 + TypeScript + Vite 8
- Supabase (Realtime DB)
- GitHub Pages 배포 (`npm run deploy`)

## 환경 변수 (.env — git 제외)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...          # 앱용 공개키 (RLS 적용)
SUPABASE_SERVICE_ROLE_KEY=...       # seed 스크립트 전용 — 절대 공개 금지
```

## 로컬 실행
```bash
npm install
npm run dev              # http://localhost:5173/
npm run seed             # disaster_roles/tasks → Supabase seed
npm run seed-employees   # employees + employee_disaster_badges → Supabase seed (dept_code/shift_group 포함)
npm run seed-duty-matrix # duty_matrix → Supabase seed (2026-07-04~, 조회 전용, PDF 값 재적재)
npm run build
npm run deploy           # GitHub Pages 배포
```

## Supabase 테이블 구조
| 테이블 | 역할 |
|---|---|
| `incidents` | 활성 재난 정보 |
| `responders` | 대원 출동 상태 |
| `member_tasks` | 발령 시 생성되는 실시간 임무 체크 |
| `disaster_roles` | 재난별 역할·badge 마스터 (seed로 관리, disa_app이 편집) |
| `disaster_tasks` | 역할별 임무 항목 마스터 (seed로 관리, disa_app이 편집) |
| `employees` | 직원 명부 (emp_no, name, team, role, is_commander, email, phone, dept_code, shift_group) |
| `employee_disaster_badges` | 직원별 재난 배지 매핑 (emp_no + disaster + shift → badge, tts_must_call) |
| `duty_matrix` | 재난×근무×반×배지×부서 임무 매트릭스. 아직 조회 전용 — 실시간 임무 배정과 미연동 |

## 재난 유형 키 목록 (disasters.ts key 값)
| key | label |
|---|---|
| `화재` | 🔥 화재 |
| `정전` | ⚡ 정전 |
| `누수` | 💧 누수·침수 (구: 홍수) |
| `태풍/홍수` | 🌀 태풍/홍수 (구: 태풍/풍수해) |
| `폭설` | ❄️ 폭설 |
| `지진` | 🌍 지진 |
| `가스누출` | 💨 가스누출 |
| `승강기` | 🛗 승강기갇힘 |
| `테러` | 🚨 테러 |

## 팀(team) → 재난 배지 매핑 원칙
- **센터장**: 전 재난 → `총괄`
- **파트장**: 해당 재난에서 `통제` 역할이 있는 경우만 별도 배지, 나머지는 파트원과 동일
  - 소방파트장: 화재 → `통제`
  - 전기파트장: 정전 → `통제`
  - 기계파트장: 태풍/홍수·가스누출 → `통제`
- **보안파트** (화재 시 3개조 분리):
  - `보안1` → 구조 / `보안2` → 유도 / `보안3` → 통제
- **주차파트**: 화재·정전·누수·지진·가스누출·테러 → `유도`
- **품질/안전파트**: 화재 → `유도`, 누수 → `지원`, 폭설 → `대응2`
- **교대 직원**: 본 파트와 동일한 배지 (team 컬럼을 본 파트명으로 설정)

## 데이터 흐름
```
disa_app (편집) → Supabase disaster_roles/tasks → twin-alarm (실행)
seed-employees.ts → Supabase employees/employee_disaster_badges → Login 직원목록/나의임무
seed-duty-matrix.ts → Supabase duty_matrix → (아직 조회 전용, 실행 흐름에 미연결)
```

## 재난 임무 매트릭스 (duty_matrix) — 현재 상태 요약
재난×근무×반×배지×부서 임무 매트릭스 마스터 데이터(2026-07-04 신설, "트윈타워_재난대응_조직도_
일원화_260703.pdf" 기준). **아직 실시간 임무 배정(ResponderView/CommanderDashboard)과 미연동
— 조회 전용 참고 데이터일 뿐, 여길 고쳐도 앱 동작은 바뀌지 않음.**
- 지휘연락반 배지(총괄=센터장/통제=재난별 담당 파트장/상황=상황실) 3분류 확정, `employees`에
  `dept_code`/`shift_group` 컬럼 추가·백필 완료
- 확정 원칙: ①통제(담당 파트장)가 아닌 파트장은 파트원과 동일 배지 ②배지 없으면 임무 없음
  (불확실한 배지를 억지로 끌어쓰지 않음)
- 미해결(회사 확인 필요): 보안3의 화재 외 재난 역할, 건축파트장 전용 행, 7개 재난(화재·지진
  제외)의 부서 매핑
- 관리 원본은 `scripts/seed-duty-matrix.ts`의 `ROWS` 배열 — **Supabase 대시보드에서 직접
  수정 금지**(재실행 시 통째로 델리트 후 재적재되므로 사라짐)
- 상세 배경·Phase 1/2 계획·배지 정합 패치 이력은 history.md "duty_matrix 신설 배경" 절 참고

## 핵심 파일
- `src/main.tsx` — 앱 진입점, SW 조기 등록 (PWA 설치 보장)
- `src/App.tsx` — 메인 앱, PWA 설치·알림 배너, 진동 알림
- `src/services/supabase.ts` — DB 타입 및 헬퍼 함수 (getEmployees, getEmployeeBadge 포함)
- `src/hooks/useRealtime.ts` — Supabase Realtime 구독
- `src/data/disasters.ts` — 재난 유형 목록 (key/label/color/icon만 관리)
- `src/components/CommanderDashboard.tsx` — 지휘관 화면 (참여인원 그룹화: 지휘연락/현장대응/대피지원/교대)
- `scripts/seed-disasters.ts` — disaster_roles/tasks DB 적재
- `scripts/seed-employees.ts` — employees + employee_disaster_badges DB 적재 (팀→배지 매핑표 포함, dept_code/shift_group 포함)
- `scripts/seed-duty-matrix.ts` — duty_matrix DB 적재. PDF 원본 데이터를 코드로 들고 있는
  유일한 곳 — 매트릭스 수정은 이 파일의 `ROWS` 배열을 고쳐서 재실행
- `supabase_schema.sql` — 전체 테이블 DDL (Supabase SQL Editor에서 실행, 10-1/10-2절이 duty_matrix 관련)
- `public/manifest.json` — PWA 매니페스트 (icon-192.png / icon-512.png 참조)
- `public/firebase-messaging-sw.js` — FCM 백그라운드 메시지 처리 서비스워커

## 참여인원 그룹 (CommanderDashboard)
재난 발령 시 직원을 4개 그룹으로 분류:
| 그룹 | 분류 기준 |
|---|---|
| 지휘연락 | 센터장, 상황실, 재난별 파트장(CMD_TEAMS) |
| 현장대응 | 해당 재난 현장 주력 파트 |
| 대피지원 | 보안·주차·운영 등 대피 지원 파트(EVAC_TEAMS) |
| 교대 | 교대 직원 (`role`에 '교대' 포함) |

## PWA 설정
- `public/manifest.json` — `start_url`, `scope`: `/twin-alarm/`
- `public/icon-192.png`, `public/icon-512.png` — 정확한 크기의 정사각형 아이콘
- `src/main.tsx` — 앱 로드 시 SW 즉시 등록 (`beforeinstallprompt` 발생 보장)
- Android Chrome: [설치] 버튼 → `beforeinstallprompt.prompt()` 호출
- iOS Safari: 하단 공유버튼 □↑ → 홈 화면에 추가
- 기존 캐시 있을 때 테스트: Chrome 설정 → 사이트 설정 → 저장된데이터 삭제

## FCM 푸시 알림
- `src/services/notifications.ts` — 알림 권한 요청 + 포그라운드 메시지
- `public/firebase-messaging-sw.js` — 백그라운드 메시지 수신 + 진동
- 진동 패턴: `[400, 150, 400, 150, 600]` (발령·승격·포그라운드 FCM 모두)

## 배포 URL
- 운영: https://atssa-kim.github.io/twin-alarm/
- 기준 브랜치: main

## Supabase 스키마 캐시 오류 시
```sql
NOTIFY pgrst, 'reload schema';
```

## duty_matrix 관리 방법 (2026-07-04~)
**원본은 `scripts/seed-duty-matrix.ts`의 `ROWS` 배열이지, Supabase 대시보드가 아닙니다.**
- 매트릭스를 고칠 땐 항상 이 파일의 `ROWS`를 수정 → `npm run seed-duty-matrix` 실행 (매번
  테이블을 통째로 지우고 다시 채우므로, 대시보드에서 직접 수정해도 재실행 시 사라짐).
- 행 하나는 `[재난, 통제자, 근무(주간|야간), 반, 배지, 부서코드|null]` 튜플.
- 재난명은 twin-alarm 기존 key(화재/정전/누수/태풍·홍수/폭설/지진/가스누출/승강기/테러) 그대로.
- **아직 실제 임무 배정에는 영향 없는 참고 데이터**입니다 (Phase 2 연동 전까지).

## 작업 이력
전체 작업 로그(날짜별 상세 변경 내용, 커밋 참조, 마이그레이션 실행 여부)는
[history.md](./history.md) 참고. 최신 항목: 2026-07-24 "TTS Edge Function 리네임
(escalate-unacked-calls → notify-tts-must-call)" 및 관련 SQL 마이그레이션 3건 라이브 DB
실행 확인 완료.

**새 작업 로그는 이 파일이 아니라 history.md에 추가할 것** — 이 파일은 200줄 이내 핵심 현재
상태만 유지.
