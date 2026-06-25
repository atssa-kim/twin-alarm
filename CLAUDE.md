# TwinTower Ops — 프로젝트 컨텍스트

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
npm run seed-employees   # employees + employee_disaster_badges → Supabase seed
npm run build
npm run deploy           # GitHub Pages 배포
```

## Supabase 테이블 구조
| 테이블 | 역할 |
|---|---|
| `incidents` | 활성 재난 정보 |
| `responders` | 대원 출동 상태 |
| `member_tasks` | 발령 시 생성되는 실시간 임무 체크 |
| `disaster_roles` | 재난별 역할·badge 마스터 (seed로 관리) |
| `disaster_tasks` | 역할별 임무 항목 마스터 (seed로 관리) |
| `employees` | 직원 명부 (emp_no, name, team, role, is_commander, email, phone) |
| `employee_disaster_badges` | 직원별 재난 배지 매핑 (emp_no + disaster → badge) |

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

## 직원 seed 현황 (2026-06-23 기준)
- 등록 완료: 49명 (센터장·운영·기계·전기·소방·건축·품질/안전파트)
- 미등록: 보안파트(보안1/2/3 구분 필요), 미화파트, 주차파트
- 재실행: `npm run seed-employees` (upsert이므로 중복 실행 무관)

## 데이터 흐름
```
disa_app (편집) → Supabase disaster_roles/tasks → twin-alarm (실행)
seed-employees.ts → Supabase employees/employee_disaster_badges → Login 직원목록/나의임무
```

## 핵심 파일
- `src/main.tsx` — 앱 진입점, SW 조기 등록 (PWA 설치 보장)
- `src/App.tsx` — 메인 앱, PWA 설치·알림 배너, 진동 알림
- `src/services/supabase.ts` — DB 타입 및 헬퍼 함수 (getEmployees, getEmployeeBadge 포함)
- `src/hooks/useRealtime.ts` — Supabase Realtime 구독
- `src/data/disasters.ts` — 재난 유형 목록 (key/label/color/icon만 관리)
- `src/components/CommanderDashboard.tsx` — 지휘관 화면 (참여인원 그룹화: 지휘연락/현장대응/대피지원/교대)
- `scripts/seed-disasters.ts` — disaster_roles/tasks DB 적재
- `scripts/seed-employees.ts` — employees + employee_disaster_badges DB 적재 (팀→배지 매핑표 포함)
- `supabase_schema.sql` — 전체 테이블 DDL (Supabase SQL Editor에서 실행)
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
