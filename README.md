# 트윈알람 (twin-alarm)

트윈타워 빌딩 재난 대응 실시간 협업 앱. 지휘관 발령, 대원 임무 체크리스트, 전체 상황판을 제공합니다.

## 로컬 실행

```bash
npm install
npm run dev              # http://localhost:5173/
```

`.env` (git 제외)에 다음이 필요합니다.

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...          # 앱용 공개키 (RLS 적용)
SUPABASE_SERVICE_ROLE_KEY=...       # scripts/ 하위 1회성 스크립트 전용
```

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

## 실시간 동기화 (2026-07-07 추가)

트윈알람의 아래 두 화면은 `disaster_roles`/`disaster_tasks` 테이블 변경을 실시간 구독(Supabase Realtime)해서, 재난대응 앱에서 저장하는 즉시 화면을 자동 갱신합니다. 별도 새로고침이 필요 없습니다.

- `AdminPanel.tsx` — 재난·주야 선택 시 보이는 배지별 임무 미리보기/배정 화면
- `ResponderView.tsx` — 발령 전 "행동 매뉴얼" 미리보기 화면

(단, 위 5번 항목대로 이미 발령된 사고의 임무 화면은 스냅샷이라 의도적으로 실시간 반영 대상이 아닙니다.)

## TTS 전화 에스컬레이션 (2026-07-23 추가)

`supabase/functions/escalate-unacked-calls`가 발령/승격 시 SOLAPI 음성전화를 겁니다.

- 화재는 배지·확인여부와 무관하게 **필수연락망 8명**(`FIRE_MUST_CALL_EMP_NOS`, 파일 상단)에게 훈련/실제 모두 즉시 전화가 갑니다. 담당자를 바꾸려면 이 emp_no 목록만 수정.
- 그 외에는 배지(재난 편제표에서 배정한 값) 기준으로 30초간 앱을 열어 확인(ack)하지 않은 사람에게만 전화가 갑니다.
- 지휘본부 발령 폼의 "TTS 전화 사용" 체크박스로 해당 발령 한 건에 한해 전화 자체를 끌 수 있습니다.
- Edge Function 배포: `supabase functions deploy escalate-unacked-calls` (CLI가 프로젝트에 이미 linked되어 있음). 대시보드 에디터로 직접 고치면 다음 CLI 배포 시 덮어써지니 코드는 항상 이 저장소 파일을 기준으로 수정하세요.

## 그 외 스크립트

```bash
npm run seed-employees   # employees 테이블만 시드 (인사 변동 시 재실행, upsert라 중복 실행 무관)
                          # — 재난 배지는 여기서 다루지 않음. 새 직원의 배지는 AdminPanel "재난 편제표" 탭에서 직접 배정.
npm run seed-duty-matrix # duty_matrix 재적재 (조회 전용 참고표, 실행 흐름과 미연동)
npm run build
npm run deploy           # GitHub Pages 배포
```
