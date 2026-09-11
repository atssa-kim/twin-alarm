# 트윈알람 (twin-alarm)

트윈타워 빌딩 재난 대응 실시간 협업 앱. 지휘관 발령, 대원 임무 체크리스트, 전체 상황판을 제공합니다. React + Vite + Supabase(DB·Realtime·Edge Functions) + Firebase(FCM 푸시) 기반이며 GitHub Pages로 배포됩니다.

## 로컬 실행

```bash
npm install
npm run dev              # http://localhost:5173/
npm run build             # tsc -b && vite build → dist/
npm run lint
```

`.env` (git 제외)에 다음이 필요합니다.

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...          # 앱용 공개키 (RLS 적용)
SUPABASE_SERVICE_ROLE_KEY=...       # scripts/ 하위 1회성 스크립트 전용
```

## 화면 구성 (역할별)

로그인 계정의 역할에 따라 `App.tsx`가 아래 화면으로 라우팅합니다.

| 컴포넌트 | 대상 | 내용 |
|---|---|---|
| `CommanderDashboard.tsx` | 지휘관 | **비상발령** — 신규 발령(훈련/실제상황), 진행 중 재난 타임라인, 참여인원·TTS 대상 지정 |
| `AdminPanel.tsx` | 지휘관(조직관리) | **재난 편제표**(배지별 인원 배정, 드래그 정렬, TTS 필수 체크) / **보고서등**(종료 재난 기록 열람, 옛 이름 "기타관리") |
| `ResponderView.tsx` | 대원 | **나의 임무** 체크리스트 + **현장 피드**(무전 로그, 텍스트/사진/동영상) — 비상 대기 중에도 지난 발령 기록은 읽기 전용 열람 가능 |
| `IncidentFeedPanel.tsx` | 공통 | 현장 피드 타임라인 UI (ResponderView·COPDashboard에서 공용) |
| `IncidentHistoryPanel.tsx` | 지휘관 | 종료된 재난 발령 기록 목록/상세 |
| `COPDashboard.tsx` | 상황실(공동 상황판) | 진행 중 재난의 인원별 임무 완료 현황 실시간 표시 |
| `Login.tsx` | 전체 | 로그인. 방재직원은 로그인 후 비상발령(지휘본부) 화면으로 이동 |

## 임무(역할·배지·할 일) 데이터는 어디서 관리하는가

이 저장소(트윈알람)와 **재난대응 앱(disa_app)**은 같은 Supabase 프로젝트를 공유하는 서로 다른 두 앱입니다.

```
재난대응 앱(disa_app) ──(편집)──▶ disaster_roles / disaster_tasks ──(읽기)──▶ 트윈알람(이 저장소)
```

| 테이블 | 소유자 | 트윈알람의 역할 |
|---|---|---|
| `disaster_roles` | **재난대응 앱** | 읽기 전용 조회 |
| `disaster_tasks` | **재난대응 앱** | 읽기 전용 조회 |
| `incidents` / `responders` / `member_tasks` | 트윈알람 | 발령·응답·체크 상태를 직접 쓰고 실시간 동기화 |
| `employees` | `scripts/seed-employees.ts` | 인사 변동 시 스크립트로 갱신 |
| `employee_disaster_badges` | 트윈알람 AdminPanel "재난 편제표" 탭 | 배지별로 인원을 직접 배정/해제 (스크립트로 건드리지 않음) |

**원칙**
1. 재난별 역할·배지·임무 내용(누가 무엇을 하는지)은 **재난대응 앱에서만 수정**합니다. 트윈알람 코드에는 `disaster_roles`/`disaster_tasks`에 쓰는 코드가 없고, 앞으로도 추가하지 않습니다.
2. `src/data/disasters.ts`는 재난 목록(`key`/`label`, 드롭다운용)만 실제로 쓰입니다. 안에 남아있는 역할·배지·임무 배열은 최초 이관 당시의 스냅샷이라 이미 실제 값과 다를 수 있는 **참고용 사본**입니다. 절대 이 파일을 실데이터의 기준으로 보지 마세요.
3. `src/data/disasters.ts` → Supabase로 통째로 밀어넣는 재시딩 스크립트(옛 `scripts/seed-disasters.ts`, `npm run seed`)는 **삭제했습니다**. 이걸 되살려 재실행하면 재난대응 앱에서 한 수정·삭제가 옛날 값으로 전부 덮어써집니다.
4. `scripts/migrations/`에 있는 `fix-*.ts`류는 특정 날짜에 배지명·임무 구조를 정리한 **1회성 마이그레이션 기록**입니다. 다시 실행할 필요 없고, 새로 비슷한 정합 작업이 필요하면 같은 방식(`scripts/migrations/fix-YYMMDD-설명.ts`, 파일 상단에 배경·매핑 규칙 주석)으로 새 파일을 추가하세요. `scripts/` 최상위에는 계속 재사용하는 도구(seed-employees, seed-duty-matrix, setup-disaster-editors)만 둡니다.
5. 진행 중인 재난(`incidents.status = 'active'`)의 `member_tasks`는 **발령 시점에 `disaster_roles`/`disaster_tasks`를 복사한 스냅샷**입니다(의도된 동작). 재난대응 앱에서 그 이후 임무를 고쳐도 이미 진행 중인 사고에는 반영되지 않고, **다음 발령부터** 새 내용이 적용됩니다.

## 화재 상황(variant) 자동 확정 (2026-08 추가)

화재처럼 세부 상황(variant)에 따라 임무가 달라지는 재난은, 발령 시 입력한 **위치 텍스트**에 특정 구역 키워드가 포함되어 있으면 발령 즉시 해당 variant를 자동 확정합니다(`CommanderDashboard.tsx`의 `LOCATION_VARIANT_KEYWORDS`). 매칭되는 키워드가 없으면 기존처럼 미확정 상태로 발령되고, 지휘관이 화면에서 수동으로 확정할 수 있습니다. variant 임무가 없는 재난(정전·지진·승강기 등)에는 이 UI 자체가 나타나지 않습니다. 새 variant/키워드를 추가할 때는 같은 파일 상단의 매핑만 채우면 됩니다.

## 실시간 동기화 (2026-07-07 추가)

트윈알람의 아래 두 화면은 `disaster_roles`/`disaster_tasks` 테이블 변경을 실시간 구독(Supabase Realtime)해서, 재난대응 앱에서 저장하는 즉시 화면을 자동 갱신합니다. 별도 새로고침이 필요 없습니다.

- `AdminPanel.tsx` — 재난·주야 선택 시 보이는 배지별 임무 미리보기/배정 화면
- `ResponderView.tsx` — 발령 전 "행동 매뉴얼" 미리보기 화면

(단, 위 5번 항목대로 이미 발령된 사고의 임무 화면은 스냅샷이라 의도적으로 실시간 반영 대상이 아닙니다.)

## TTS 전화 (2026-07-24 재설계 — 30초 대기·배지 에스컬레이션 전부 삭제)

`supabase/functions/notify-tts-must-call`(2026-07-24 이전 이름은 `escalate-unacked-calls` — 30초 미확인자 에스컬레이션 로직을 삭제하고 나니 옛 이름이 안 맞아서 리네임)가 발령/승격 시 SOLAPI 음성전화를 겁니다. 규칙은 딱 하나:

- **실제상황(훈련 아님)**: 재난 발령/승격 즉시(대기 없이) **TTS 필수인원**(`employee_disaster_badges.tts_must_call=true`)에게 전화. 항상 발신 — 끌 수 없습니다. AdminPanel "재난 편제표" 탭에서 배지 배정된 사람마다 "TTS 필수" 체크박스로 재난별 관리 — 코드 수정·재배포 없이 바로 반영됩니다. 예전 화재 전용 8명 하드코딩 배열(`FIRE_MUST_CALL_EMP_NOS`)은 폐지되고 재난 무관하게 일반화됨.
- **훈련**: 재난 발령/승격 즉시(대기 없이), 지휘본부 "훈련 참여인원 설정"/"2차 소집 대원" 화면에서 **사람별로 체크한 "TTS" 대상**(`incidents.tts_emp_nos`, 참여 여부와 독립적으로 선택)에게만 전화. 실제상황의 TTS 필수인원(고정 명단)과는 별개 목록 — 훈련마다 테스트하고 싶은 사람이 다를 수 있어 그때그때 고릅니다. 아무도 안 체크하면 그 훈련은 전화 자체가 안 갑니다(별도 on/off 체크박스 없음 — 2026-07-24 최종 정정).
- **야간(shift='night')은 TTS를 아예 쓰지 않습니다**: 야간 근무자는 항상 무전기를 휴대하고 있어 불필요하다는 판단 — 함수가 야간이면 바로 종료됩니다.
- 예전에 있던 "30초 대기 후 앱을 안 연 사람에게 배지(총괄/통제/상황 등) 기준으로 전화" 로직은 2026-07-24에 완전히 삭제했습니다. `incident_acks`(확인 기록)는 여전히 쌓이지만 이 함수는 더 이상 참조하지 않습니다.
- **처리 결과는 `incident_call_escalations`에 감사(audit) 기록으로 남습니다**: `target_count`/`called_count`/`error`/`completed_at` 컬럼으로 몇 명에게 걸렸는지, 실패했다면 왜 실패했는지 나중에 조회할 수 있습니다.
- Edge Function 배포: `supabase functions deploy notify-tts-must-call` (CLI가 프로젝트에 이미 linked되어 있음). 대시보드 에디터로 직접 고치면 다음 CLI 배포 시 덮어써지니 코드는 항상 이 저장소 파일을 기준으로 수정하세요.
- DB 변경사항은 `scripts/migrations/fix-escalation-audit-260724.sql`·`scripts/migrations/add-tts-must-call-260724.sql`·`scripts/migrations/rename-tts-function-260724.sql`을 Supabase SQL Editor에서 1회 실행해야 반영됩니다(순서 무관, 마지막 것은 트리거가 새 함수명을 호출하도록 재지정 — 실행 전까진 옛 함수 이름으로 계속 호출되니 통화가 끊기지 않음).

## Supabase Edge Functions

`supabase/functions/`에 있으며 CLI로 배포합니다(`supabase functions deploy <이름>`). 대시보드 에디터로 직접 고치면 다음 CLI 배포 시 덮어써지니 코드는 항상 이 저장소 파일 기준으로 수정하세요.

| 함수 | 트리거 | 역할 |
|---|---|---|
| `notify-incident` | 발령/승격/참여 갱신 | 참여 대상에게 FCM 푸시(+중복축소된 SMS) 발송 |
| `notify-tts-must-call` | 발령/승격 | TTS 필수인원(실제상황) / 사람별 TTS 선택(훈련)에게 SOLAPI 음성전화. 상세 규칙은 아래 "TTS 전화" 절 참고 |
| `generate-report` | 수동 호출 | 종료된 재난의 보고서 생성 |

## 그 외 스크립트

```bash
npm run seed-employees        # employees 테이블만 시드 (인사 변동 시 재실행, upsert라 중복 실행 무관)
                               # — 재난 배지는 여기서 다루지 않음. 새 직원의 배지는 AdminPanel "재난 편제표" 탭에서 직접 배정.
npm run seed-duty-matrix      # duty_matrix 재적재 (조회 전용 참고표, 실행 흐름과 미연동)
npm run backup                # scripts/backup-db.ts — DB 백업
npm run setup-disaster-editors # disa_app 쪽 재난 편집 권한 계정 설정
npm run deploy                 # gh-pages -d dist — GitHub Pages 배포
```

`scripts/migrations/`의 `fix-*`/`add-*`/`reset-*` 파일들은 특정 날짜에 실행한 **1회성 마이그레이션 기록**입니다(`_APPLIED.md`에 적용 이력). 다시 실행할 필요 없고, 비슷한 정합 작업이 필요하면 같은 방식(`scripts/migrations/fix-YYMMDD-설명.ts|sql`, 파일 상단에 배경·매핑 규칙 주석)으로 새 파일을 추가하세요. `package.json`의 `scripts`에는 실행 편의를 위해 그중 일부만 등록되어 있으며, 나머지는 `npx tsx scripts/migrations/<파일명>.ts`로 직접 실행합니다.
