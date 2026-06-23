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
VITE_SUPABASE_ANON_KEY=...
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

## 현재 브랜치: feature/supabase-disaster-db
- 정적 ROSTER 제거 → `employees` DB 테이블로 대체
- `currentUser.badge` 정적 배지 제거 → 재난 발령 시 `employee_disaster_badges` 에서 동적 조회

## 데이터 흐름
```
disa_app (편집) → Supabase disaster_roles/tasks → twintower-ops (실행)
seed-employees.ts → Supabase employees/employee_disaster_badges → Login 직원목록/나의임무
```

## 핵심 파일
- `src/services/supabase.ts` — DB 타입 및 헬퍼 함수 (getEmployees, getEmployeeBadge 포함)
- `src/hooks/useRealtime.ts` — Supabase Realtime 구독
- `src/data/disasters.ts` — 재난 유형 목록 (key/label/color/icon만 관리)
- `scripts/seed-disasters.ts` — disaster_roles/tasks DB 적재
- `scripts/seed-employees.ts` — employees + employee_disaster_badges DB 적재 (팀→배지 매핑표 포함)
- `supabase_schema.sql` — 전체 테이블 DDL (Supabase SQL Editor에서 실행)

## 배포 URL
- 운영: https://atssa-kim.github.io/twintower-ops
- 기준 브랜치: main (feature 브랜치 작업 완료 후 merge)

## Supabase 스키마 캐시 오류 시
```sql
NOTIFY pgrst, 'reload schema';
```
