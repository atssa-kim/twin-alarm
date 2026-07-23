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
npm run seed-employees   # employees + employee_disaster_badges → Supabase seed (dept_code/shift_group 포함)
npm run seed-duty-matrix # duty_matrix → Supabase seed (2026-07-04~, 조회 전용, PDF 값 재적재)
npm run fix-badges-260704 # disaster_roles 배지명 정합 패치 (화재 소화→조치, 가스누출 지휘→총괄) — 1회 실행 후 seed-employees 재실행 필요
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
| `employees` | 직원 명부 (emp_no, name, team, role, is_commander, email, phone, **dept_code, shift_group** ← 2026-07-04 추가) |
| `employee_disaster_badges` | 직원별 재난 배지 매핑 (emp_no + disaster → badge). **아직 근무(주간/야간) 구분 없음** — PK가 (emp_no, disaster)라 재난당 배지 1개뿐 |
| `duty_matrix` | **(신규, 2026-07-04)** 재난×근무×반×배지×부서 임무 매트릭스. 아직 조회 전용 — 위 두 테이블과 자동 연동 안 됨. 상세는 아래 "재난 임무 매트릭스" 절 참고 |

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
seed-duty-matrix.ts → Supabase duty_matrix → (아직 조회 전용, 실행 흐름에 미연결)
```

## 재난 임무 매트릭스 (duty_matrix) — 2026-07-04 신설, Phase 1만 완료

### 배경
기존에는 팀→재난→배지 매핑표(`TEAM_BADGE_MAP`)가 **세 군데에 따로 하드코딩**돼 있었음
(`scripts/seed-employees.ts`, `src/components/AdminPanel.tsx`, 그리고 참여인원 그룹핑용
`CMD_TEAMS`/`EVAC_TEAMS`가 `AdminPanel.tsx`·`CommanderDashboard.tsx` 두 군데 중복). 또한
근무(주간/야간) 구분이 스키마 어디에도 없어서, 같은 직원이 교대로 야간 근무를 해도 재난 배지는
하나만 가질 수 있었음. 회사에서 받은 "트윈타워_재난대응_조직도_일원화_260703.pdf"를 기준으로
이 구조를 통합하기 시작한 것이 `duty_matrix` 테이블.

### 현재 상태 (Phase 1 — 데이터만 존재, 아직 앱에 미연결)
- `duty_matrix` 테이블: 재난(9종) × 근무(주간/야간) × 반(division) × 배지(badge) × 부서(dept_code)
  37+행 마스터. `scripts/seed-duty-matrix.ts` 실행 시 델리트 후 전체 재적재(idempotent).
- 지휘연락반(주간+야간, 9개 재난 전체 통일된 명칭, 가운뎃점 없음)은 3개 배지로 확정:
  | 배지 | 대상 | dept_code |
  |---|---|---|
  | 총괄 | 센터장 | `총괄` |
  | 통제 | 그 재난의 담당 파트장(화재·지진→소방, 정전·승강기→전기, 누수·태풍/홍수·가스누출→기계, 폭설·테러→운영) | 해당 부서 코드 |
  | 상황 | 상황실 | `상황` |
- `employees`에 `dept_code`(부서, team보다 세분화 — 건축사무→건축2, 건축현장→건축1, 교대
  상황실 인원→야전기/야BMS/야운전/야소방 등)와 `shift_group`(NULL|A|B|C|D) 컬럼 추가,
  `seed-employees.ts`의 기존 60명 데이터에 값 백필 완료.
- **`employee_disaster_badges`, `AdminPanel.tsx`, `CommanderDashboard.tsx`, `ResponderView.tsx`는
  아직 하나도 안 바뀜.** 즉 지금 앱을 실제로 써도 동작은 이전과 100% 동일함 — duty_matrix는
  아직 "참고용 마스터 데이터"일 뿐 실시간 임무 배정에 영향 없음.

### 배지 정합 패치 완료 — 화재·가스누출 (2026-07-04, `scripts/fix-badges-260704.ts`)
Phase 1 데이터와 기존 라이브 시스템(`disaster_roles`/`TEAM_BADGE_MAP`)을 대조해보니 duty_matrix
연결 이전에도 이미 깨져 있던 부분들이 있어서, 두 재난만 우선 정합했습니다:
- **화재**: 기계파트 `소화`→`조치`로 통일(disaster_roles 쪽 이름 변경), 보안1 `응급`→`구조`로 통일,
  보안2 `경계`→`유도`로 통일, **보안3의 화재 임무 자체를 삭제**(기존엔 소방파트장과 임무가
  뒤섞이는 버그였음).
- **가스누출**: 센터장 `지휘`→`총괄`로 통일 — 기존엔 disaster_roles에 `총괄` 역할이 없어서
  **센터장이 가스누출 발령 시 임무를 아예 못 보고 있었음**(duty_matrix 연동과 무관한 기존 버그).
  전기/운영/주차파트는 무엇을 해야 할지 정해진 게 없는데 그럴듯한 배지(지원/유도)를 억지로
  쓰고 있어서 오히려 없는 역할과 매칭돼 빈 화면이 뜨고 있었음 → 배지 자체를 제거.
- **확정된 원칙 2가지** (앞으로 다른 재난에도 적용):
  1. "통제(그 재난 담당 파트장)가 아닌 파트장은 파트원과 동일 배지" — 전기·운영·건축은 이미
     이 원칙대로였고, 각 재난에서 담당 파트장(=통제)만 예외.
  2. **"배지없으면 임무없음"** — 부서-배지 매핑이 불확실하면 비슷한 배지를 억지로 끌어쓰지 않고
     아예 배지를 안 준다. (근거: 잘못된 배지는 "임무 있음"처럼 보이지만 실제로는 엉뚱하거나
     빈 임무를 보여줘서 오히려 더 위험함 — 안 보이는 게 차라리 안전)
- **주의**: `disaster_roles`의 badge를 UPDATE했으므로 (a) Supabase에서
  `npx tsx scripts/fix-badges-260704.ts` 실행, (b) 이어서 `npm run seed-employees` 재실행해서
  `employee_disaster_badges`의 실제 값도 새 매핑으로 갱신해야 반영됩니다. 둘 다 아직 실제
  Supabase에 적용 안 됐다면(로컬 코드만 수정) 반드시 실행하세요.
- 태풍/홍수·폭설·지진·테러 4개 재난에도 가스누출과 동일한 "지휘"/"총괄" 불일치가 있으나
  이번 지시 범위는 화재·가스누출뿐이라 손대지 않음.

### 확실하지 않아서 임의로 채우지 않은 부분
- **보안3**: 화재는 임무를 삭제했지만, 다른 재난에서의 보안3 역할은 여전히 PDF 매트릭스에
  정의가 없음. `employees.dept_code='보안3'`으로만 남겨둠.
- **건축파트장**: PDF에 파트장 전용 행이 없어 건축사무(건축2)와 동일하게 임시 처리.
- **PDF 자체가 화재·지진만 부서구분(dept_code)이 채워져 있고, 나머지 7개 재난(정전·누수·
  태풍/홍수·폭설·가스누출·승강기·테러)의 현장대응반/대피유도반/지원반은 배지만 있고 부서
  매핑이 비어있음.** 회사 쪽에서 부서를 확정해줘야 채울 수 있는 부분(가스누출의 전기/운영/
  주차파트가 배지 없는 상태로 남아있는 이유).

### Phase 2 — 다음에 해야 할 것 (아직 시작 안 함)
1. **회사에 확인**: 위 "확실하지 않은 부분"(보안3 나머지 재난, 건축파트장, 7개 재난 부서 매핑)
   답 받기 — 이게 없으면 Phase 2를 정확히 진행할 수 없음.
2. **`disa_app` 정합**: duty_matrix의 배지 체계(특히 지휘연락반 총괄/통제/상황)가
   `disaster_roles.badge`(disa_app이 관리)와 일치하는지 맞추는 작업. disa_app 쪽 수정이
   필요할 수 있음.
3. **`employee_disaster_badges`에 근무(shift) 축 추가**: 현재 PK가 `(emp_no, disaster)`라
   재난당 배지 1개뿐 → `(emp_no, disaster, shift)`로 변경해서 교대 직원이 주간/야간 배지를
   동시에 가질 수 있게. (스키마 변경 + 기존 데이터 마이그레이션 필요)
4. **`AdminPanel.tsx`의 `TEAM_BADGE_MAP` 자동배정 로직을 `duty_matrix` 조회로 교체**:
   직원 저장 시 `dept_code`+`shift_group` 기준으로 duty_matrix를 찾아 배지를 자동 upsert.
5. **`CommanderDashboard.tsx`/`AdminPanel.tsx`의 `CMD_TEAMS`/`EVAC_TEAMS`/`getOrgGroup()`
   중복 제거**: duty_matrix의 division(반) 값을 단일 소스로 참여인원 그룹핑에 사용.
6. **발령 시 주간/야간 판정 로직 추가**: `incidents` 테이블에 `shift` 컬럼 추가,
   `CommanderDashboard.tsx`의 `handleDeclare()`에서 발령 시각 기준(예: 06~18시=주간) 자동
   판정 후 저장. `ResponderView.tsx`의 `getEmployeeBadge()` 호출도 `incident.shift`를
   같이 넘기도록 확장.

## 핵심 파일
- `src/main.tsx` — 앱 진입점, SW 조기 등록 (PWA 설치 보장)
- `src/App.tsx` — 메인 앱, PWA 설치·알림 배너, 진동 알림
- `src/services/supabase.ts` — DB 타입 및 헬퍼 함수 (getEmployees, getEmployeeBadge 포함)
- `src/hooks/useRealtime.ts` — Supabase Realtime 구독
- `src/data/disasters.ts` — 재난 유형 목록 (key/label/color/icon만 관리)
- `src/components/CommanderDashboard.tsx` — 지휘관 화면 (참여인원 그룹화: 지휘연락/현장대응/대피지원/교대)
- `scripts/seed-disasters.ts` — disaster_roles/tasks DB 적재
- `scripts/seed-employees.ts` — employees + employee_disaster_badges DB 적재 (팀→배지 매핑표 포함, dept_code/shift_group 포함)
- `scripts/seed-duty-matrix.ts` — **(2026-07-04 신규)** duty_matrix DB 적재. PDF 원본 데이터를
  코드로 들고 있는 유일한 곳 — 매트릭스 수정은 이 파일의 `ROWS` 배열을 고쳐서 재실행
- `scripts/fix-badges-260704.ts` — **(2026-07-04 신규)** disaster_roles 배지명 1회성 정합 패치
  (화재 소화→조치, 가스누출 지휘→총괄). 재실행해도 안전(idempotent).
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
- 매트릭스를 고칠 땐 항상 이 파일의 `ROWS`를 수정 → `npm run seed-duty-matrix` 실행.
  이 스크립트는 매번 테이블을 **통째로 지우고 다시 채우는 방식**이라(idempotent 재적재),
  Supabase SQL Editor나 Table Editor에서 직접 행을 추가/수정해도 다음 재실행 시 사라집니다.
- 행 하나는 `[재난, 통제자, 근무(주간|야간), 반, 배지, 부서코드|null]` 튜플입니다. 부서가
  2개 걸치던 PDF 원본 행은 이미 부서별로 쪼개 놨으니, 새 부서를 추가할 땐 같은 배지로
  한 줄 더 추가하면 됩니다.
- 재난명은 twin-alarm 기존 key(화재/정전/누수/태풍·홍수/폭설/지진/가스누출/승강기/테러)
  그대로 써야 합니다 — PDF 원문 표기(누수/침수, 풍수해, 승강기 갇힘)를 그대로 쓰면 안 됨.
- 고칠 때마다 파일 상단 docblock 주석(배지 체계, division 통일 이력)도 같이 업데이트해서,
  다음에 열어보는 사람(또는 다음 세션의 나)이 "왜 이렇게 돼 있는지" 바로 알 수 있게 유지하세요.
- **아직 실제 임무 배정에는 영향이 없는 참고 데이터**라는 점을 잊지 마세요. 여기를 고쳤다고
  해서 앱에서 보이는 임무 체크리스트가 바뀌지는 않습니다 (Phase 2 연동 전까지는).
- Phase 2로 넘어가 `employee_disaster_badges`/`AdminPanel.tsx`와 실제로 연동한 뒤에는,
  이 파일이 곧 "재난 임무 배정 규정"이 되므로 수정 시 반드시 관련자 확인을 받고 바꿀 것.

## 작업 로그 — 2026-07-23

### 1. GitHub 동기화 확인
로컬 main이 origin/main보다 **30개 커밋 뒤처져** 있던 걸 발견(직전 세션 이후 다른 곳에서
TTS 에스컬레이션·배지 세분화 등 대량 작업이 이미 푸시돼 있었음). `git pull --rebase`로
받아온 뒤, 로컬에만 있던 archive 정리(중복 연락처 파일 삭제, 오탈자 수정)와 `.gitignore`에
`.claude/`·`.omc/`(로컬 도구 상태 폴더) 추가를 리베이스해서 푸시함.

### 2. 화재/주간 '상황실' 배지 중복 정리 (DB)
`disaster_roles`에 화재/day용 상황실 관련 역할이 **3개 중복**으로 남아있던 걸 발견:
- `상황`(id=3, 47건) — 이미 병합·2026-07-13 재분류까지 반영된 최종본
- `상황실`(id=810, 33건), `상황실/화재`(id=811, 19건) — `fix-badges-260705b.ts`가
  병합 후 삭제하도록 설계됐으나 라이브 DB엔 삭제가 반영 안 돼 남아있던 잔재

`상황실` 배지를 쓰던 직원 11명(김범재·손경배·유지원·심현보·김성·석경민·이태경·윤창현 등)을
`상황`으로 재배정하고, 중복 역할 2개(및 CASCADE로 딸린 임무들) 삭제.
→ `scripts/migrations/fix-badges-260723-dedup-situation-room.ts` (idempotent, 커밋됨)

### 3. 재난 미리보기 임무 개수 불일치 수정
증상: 화재 미리보기 "나의 임무"에 소방파트장(통제 배지)이 16건만 뜨는데, 매뉴얼상 전체는
38건 — 원인은 `ResponderView.tsx`의 미리보기 로직이 발령 전엔 상황(variant) 미확정이라며
variant 있는 임무(K급주방/가스구역/UPS실/지하주차장, 22건)를 숨기고 공통 임무 16건만
보여주고 있었음(의도된 설계였으나 이번에 매뉴얼과 동일하게 전체를 보여주는 쪽으로 변경 확정).

`previewTasks`(ResponderView.tsx:720~)에서 `.filter(dt => !dt.variant)` 제거 →
미리보기도 재난대응매뉴얼과 동일하게 전체 임무 표시. 실제 발령 후 상황 확정 시 필터링하는
로직(`rawTasks`, ResponderView.tsx:316, `activeIncident?.variant` 비교)은 그대로 유지 —
이 변경은 발령 전 미리보기 화면에만 영향.

`npm install`(node_modules 비어있었음) → `npm run build` → `npm run deploy`로
GitHub Pages(https://atssa-kim.github.io/twin-alarm/) 반영 완료.

### 4. 훈련 참여인원설정에 사람별 "TTS 전화 받기" 체크박스 추가
기존엔 훈련 중 TTS 무응답자 전화가 항상 배지(통제)로만 걸렸고, "훈련 참여인원 설정"에서
선택한 참여인원(drill_emp_nos)과는 완전히 무관했음(참여인원을 좁혀도 통제 배지 전원에게
전화가 감). 요청에 따라 **참여 여부와 독립적인** 별도 지정 방식으로 구현:

- `EmployeeGroupPicker`(CommanderDashboard.tsx) 각 직원 행에 참여 체크박스와 별개로
  "TTS" 체크박스 추가, 툴바에 "📞 파트장 전체 TTS"(role==='파트장' 일괄 체크) 버튼 추가.
- 발령 시(`ttsEmps`)·2차 소집 승격 시(`escalateTtsEmps`) 각각 상태 관리, 콤마구분 문자열로
  `incidents.tts_emp_nos`에 저장(`declareIncident`/`escalateIncident` 신규 파라미터,
  `src/services/supabase.ts`).
- `escalate-unacked-calls`(Edge Function): 훈련이고 `tts_emp_nos`가 지정돼 있으면 배지 조회를
  건너뛰고 그 목록만 대상으로 함. 미지정 시 기존 배지(통제) 기준 동작 그대로 유지(하위호환).
- DB: `incidents.tts_emp_nos text` 컬럼 필요 —
  `scripts/migrations/add-tts-emp-nos-260723.sql`. **직접 실행 권한(DB 비밀번호)이 없어
  Supabase SQL Editor에서 수동 실행 필요** — 실행 전까지는 컬럼이 없어도 안전하게 기존
  배지 기준 동작으로 폴백됨(트리거가 `row_to_json(NEW)`로 행 전체를 넘기므로 컬럼 없으면
  `record.tts_emp_nos`가 `undefined`).
- Edge Function은 `supabase functions deploy escalate-unacked-calls`로 배포 완료. 프론트는
  `npm run build && npm run deploy`로 GitHub Pages 반영 완료.

### 5. "파트장 TTS" 버튼 파트장 판정 버그 수정 + 운영파트장 인사 정리
"파트장 TTS" 버튼(role==='파트장' 기준)이 소방파트장(김견수, role: '파트장(안전관리자)')을
놓치는 버그 발견 → team명 화이트리스트(`PART_LEADER_TEAMS` = 소방/전기/기계/건축/운영파트장)
로 교체.

이 과정에서 라이브 DB를 보니 **곽우람(E-1001, 운영파트장)이 이미 삭제되어 있고 박세훈
(E-1003)이 이미 파트장으로 승격되어 있었음**(배지도 이미 본인 앞으로 정상 배정됨) — 다만
`team` 값이 다른 4개 파트장과 다르게 `'운영파트'`(파트원과 동일)로 남아있어서, `team`명
문자열로 매칭하는 CMD_TEAMS(폭설 지휘연락 분류)·PART_LEADER_TEAMS 등에서 누락되는 상태였음.
`team`을 다른 파트장과 동일한 규칙(`'운영파트장'`)으로 정정, `scripts/seed-employees.ts`도
라이브 상태에 맞춰 곽우람 행 제거 + 박세훈 team/role/is_commander 갱신(다음에 스크립트를
재실행해도 되돌아가지 않도록). 프론트 코드 변경 없어 재배포는 불필요.

### 6. TTS 전화 로직 정리 + 사람별 TTS 체크박스 기능 제거
사용자 요청으로 TTS 전화 대상 규칙을 화재(훈련/실제 × 감지기동작/전체, 주/야간)·기타 8개
재난·"TTS 전화 사용" 체크박스와의 관계까지 정리해서 설명. 이 과정에서 **화재 야간(night)
30초-미확인자 전화가 현재 아무도 대상이 안 되는 문제를 발견**함 — `employee_disaster_badges`의
화재/night 배지가 `현장`·`대피`뿐이고 `총괄`/`통제`/`출동`/`상황` 이름으로 배정된 사람이 없어서
(day는 정상 배정), FIRE_INITIAL_BADGES/COMMAND_BADGES 배지 조회가 항상 0명으로 나옴. 필수연락망
8명 즉시발신은 주/야간 무관하게 정상 동작하므로 완전 무대응은 아니지만, 확인 안 한 나머지
인원에게는 야간엔 전화가 안 감. **이번엔 손대지 않음 — 필요시 별도로 요청받아 처리.**

또한 §4에서 만들었던 "참여인원설정 사람별 TTS 체크박스"(`tts_emp_nos`) 기능은, `isTraining &&`
로 완전히 훈련 전용으로 게이트돼 있어 실제 상황엔 전혀 영향이 없음을 재확인 → 사용자 지시로
**전체 제거**. `EmployeeGroupPicker`의 TTS 체크박스·"📞 파트장 TTS" 버튼(및 그 대상 판정용
`PART_LEADER_TEAMS`)·`ttsEmps`/`escalateTtsEmps` 상태·`declareIncident`/`escalateIncident`의
`ttsEmpNos` 인자·`Incident.tts_emp_nos` 타입 필드를 모두 되돌리고, `escalate-unacked-calls`도
배지 조회만 쓰는 이전 로직으로 복원 후 재배포. `incidents.tts_emp_nos` DB 컬럼(SQL 마이그레이션
`add-tts-emp-nos-260723.sql`)은 실행했더라도 그냥 안 쓰는 nullable 컬럼으로 남아 무해하므로
DROP은 안 함. README.md의 관련 문단도 제거.

TTS 전화 현재 로직 정리 (2026-07-24 수정 반영)
1. 화재
감지기동작	화재확정(전체)
훈련(주간만)	mode=훈련/감지기 — 필수연락망 8명 즉시발신 + 30초 후 미확인 통제만	mode=훈련/전체 — 동일
실제·주간	mode=실제/감지기(scope=fire_initial) — 필수연락망 8명 즉시발신 + 30초 후 미확인 총괄/통제/출동	mode=실제/화재 — 필수연락망 8명 즉시발신 + 30초 후 미확인 총괄/통제/출동 제외한 나머지 전 배지(감지기 단계 생략 시엔 전 배지)
실제·야간	필수연락망 8명 즉시발신 제외(주간 근무자라 퇴근 상태) — 30초 후 미확인 배지 대상자에게만 전화. 단 총괄/통제/출동/상황 배지 보유자가 현재 없어(현장·대피만 배정됨) 사실상 아무도 안 걸림(기존부터 있던 별도 이슈, 미해결)	동일
주간 공통: 필수연락망 8명은 훈련/실제 구분 없이 항상 즉시 전화. 야간은 필수연락망 제외(이번에 수정).

2. 기타 8개 재난
항상 주간만 존재. mode가 훈련이면 통제만, 실제면 총괄/통제/상황(지휘연락급) 대상으로 30초 후 미확인자에게 전화. 필수연락망 개념 없음(화재 전용).

### 7. TTS 에스컬레이션 전체 코드 리뷰 + 발견된 문제 일괄 수정
위 §6에서 "화재 실제·야간은 총괄/통제/출동/상황 배지가 없어 사실상 아무도 안 걸림"이라고
적었는데, **다시 정밀하게 코드를 추적해보니 그 설명이 부정확했음** — `fireInitialAlreadyHandled`
(감지기동작 이미 거침) 분기와 "감지기동작 없이 바로 전체화재" 분기는 애초에 FIRE_INITIAL_BADGES로
좁히지 않아서 야간에도 `현장`/`대피` 18명이 걸리고 있었음. 진짜 0명이었던 건 `isFireInitial`
(감지기동작) 단계 하나뿐. 정정.

전체 코드 리뷰로 추가 발견한 문제들, 전부 수정:

1. **[심각] `incident_acks` 단계별 확인 격리가 실제로는 안 됨**: `ackIncident()`의
   `onConflict: 'incident_id,emp_no'`에 mode가 빠져있어서, 승격되어 mode가 바뀌면 앱이
   열려있기만 해도(사람이 아무것도 안 해도) 자동으로 새 단계 "확인됨"으로 덮어써짐 — 세 군데
   주석(supabase.ts/App.tsx/fix-escalation-bugs-260720.sql)이 전부 "mode별로 분리된다"고
   설명하는데 실제로는 안 그랬음(PK가 (incident_id,emp_no)뿐이라 mode 컬럼은 그냥 최신값으로
   갱신될 뿐). PK를 `(incident_id, emp_no, mode)`로 변경, `onConflict`도 맞춤.
2. **[중간] 에스컬레이션 실패 시 무한 침묵**: `(incident_id, mode)` 클레임을 30초 대기 **전**에
   선점해서, 클레임 이후 어떤 이유로든 실패하면(쿼리 에러, 타임아웃 등) 재시도도 실패 알림도
   없이 완전히 조용히 사라짐. `incident_call_escalations`에 `scope`/`must_call_count`/
   `target_count`/`called_count`/`error`/`completed_at` 감사 컬럼 추가, 매 종료 경로(성공/실패/
   대상없음/전원확인/사고종료)에서 `recordResult()`로 기록하도록 수정. 클레임 INSERT 자체가
   실패한 경우도 unique_violation(23505, 진짜 중복)과 그 외 에러(진짜 실패)를 구분해서 로깅.
3. **[경미] `fireInitialAlreadyHandled` 판정이 `mode LIKE '%감지기%'` 문자열 매칭**: mode
   네이밍이 바뀌면 조용히 깨질 수 있어서, `incident_call_escalations.scope='fire_initial'`
   비교로 교체(위 감사 컬럼에 scope도 같이 저장).
4. **[경미] SOLAPI 발신 성공/실패가 로그에만 남음**: `sendSolapiMessages`/`sendVoiceCalls`가
   결과(`{sent, ok, error}`)를 반환하도록 바꿔서 위 감사 컬럼에 기록되게 함.
5. **화재 야간 배지 필터 재정비 + 오늘 근무조(A~D) 좁히기**: `isFireInitial`/
   `fireInitialAlreadyHandled` 분기를 `shift !== 'night'`로 한정해서, 야간은 항상
   "그 shift에 배정된 전 배지"를 대상으로 하도록 통일(감지기동작 단계도 이제 0명이 아님).
   추가로 `incidents.night_duty_group`(A|B|C|D) 컬럼 신설 — 지휘본부가 화재 야간 발령 시
   오늘 실제 근무조를 고르면(CommanderDashboard.tsx, 필수 입력) TTS 대상을 그 조
   (`employees.shift_group`)로만 좁혀서, 4교대 중 비번인 3개조까지 전화가 가던 문제 해결.

DB 변경은 `scripts/migrations/fix-escalation-audit-260724.sql` — Supabase SQL Editor에서
수동 실행 필요(직접 실행 권한 없음). Edge Function·프론트 모두 재배포 완료.

### 8. TTS 정책 재설계 — 야간 TTS 완전 제거 + 필수인원 AdminPanel 체크박스로 일반화
§7에서 만든 "야간 근무조(A~D) 선택" 기능이 하루도 안 돼서 바로 폐기됨 — 사용자가 "야간엔
항상 무전기를 휴대하고 있어 TTS가 아예 없어도 된다"고 판단. 세 가지 지시를 반영:

1. **야간은 TTS 자체를 스킵**: `escalate-unacked-calls`가 `shift==='night'`이면 맨 위에서
   바로 종료(필수인원 즉시발신도, 30초-미확인자 발신도 전혀 안 함). 이로써 §7의
   `night_duty_group`(4교대 근무조 좁히기)도 자동으로 필요 없어짐 — CommanderDashboard의
   "오늘 야간 근무조" 선택 UI·상태·`declareIncident` 파라미터까지 전부 되돌림.
   `incidents.night_duty_group` 컬럼 자체는 무해하게 남겨둠(DROP 안 함, 그냥 안 씀).
2. **TTS 필수인원을 화재 전용 하드코딩 8명(`FIRE_MUST_CALL_EMP_NOS`)에서 재난 무관
   일반화 + AdminPanel 체크박스 관리로 전환**: `employee_disaster_badges`에
   `tts_must_call boolean` 컬럼 추가. AdminPanel "재난 편제표" 탭에서 배지 배정된 사람
   행마다 "TTS 필수" 체크박스 추가(`handleToggleTtsMustCall` → `db.setTtsMustCall`) —
   담당자가 코드 수정·재배포 없이 재난별로 직접 관리 가능. 기존 화재 8명은
   `add-tts-must-call-260724.sql`에서 화재/주간 배지에 그대로 이관(전원 기존 배지 보유
   확인 후 UPDATE로 안전하게 처리).
3. **필수인원 즉시발신은 실제상황(훈련 아님)에만 적용**: 훈련은 여전히 §1의 통제-배지
   30초 대기 방식만 사용, "TTS 전화 사용" 체크박스로 훈련/실제 공통 on-off.

DB 변경은 `scripts/migrations/add-tts-must-call-260724.sql` 추가 실행 필요(위 §7 SQL도
여전히 필요 — ack/감사 컬럼 부분은 이번 변경과 무관하게 유효). Edge Function·프론트
모두 재배포 완료.

미해결로 남은 것: 화재 야간 30초-미확인자 전화가 현재 대상자 0명입니다(배지 미배정). A~D 4개조 운영 특성상 어떻게 대상을 정할지는 지난 답변에서 드린 대로 검토 중이고, 방향 정해지면 이 부분도 같이 고치겠습니다.