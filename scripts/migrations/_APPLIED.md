# migrations 이력 정리표

> **파일은 하나도 삭제하지 않았습니다 — 분류만 합니다.** 이 표는 각 SQL/TS 파일이 현재
> 라이브 DB 상태를 대표하는 "최종본"인지, 이후 파일에 의해 내용이 대체된 "중간본(시행착오)"
> 인지, 아니면 실행 여부 자체가 불확실한지 구분한 것입니다. 코드 안에 직접적인 실행 로그가
> 없어서(전부 Supabase SQL Editor에서 수동 실행), 판단 근거는 ①이후 파일의 주석이 명시적으로
> "~를 대체/삭제한다"고 밝힌 경우 ②`Archive/history.md`의 작업 로그에 실행 확인이 기록된 경우
> ③현재 앱 코드가 그 결과에 의존하는지 여부, 세 가지입니다. DB에 직접 접속해 확인한 게
> 아니므로 "불확실" 항목은 반드시 Supabase SQL Editor에서 실제 상태를 재확인하세요.

## 분류 기준
| 분류 | 의미 |
|---|---|
| ✅ 최종본 | 지금 라이브 DB 상태를 대표하는 것으로 판단됨. 이후 이 내용을 뒤집은 파일이 없음 |
| 🔁 중간본 | 이후 파일이 내용의 전부 또는 일부를 대체·삭제함 (시행착오 과정) |
| 🐞 디버그 전용 | 파일 자체가 "진단 후 되돌릴 것"이라고 명시한 임시 버전 — 애초에 최종본으로 의도되지 않음 |
| ❓ 불확실 | 실행 여부/현재 라이브 상태를 코드만으로 확인할 수 없음 — 직접 확인 필요 |

---

## A. 배지/역할 정합 (disaster_roles · employee_disaster_badges)

| 파일 | 날짜 | 분류 | 근거 |
|---|---|---|---|
| `fix-badges-260704.ts` | 07-04 | 🔁 중간본 | 화재 `소화→조치`는 바로 다음날 `260705`가 `조치→대응`으로 다시 바꿔 대체됨. 가스누출 `지휘→총괄` 부분만 지금도 유효 |
| `fix-badges-260705.ts` | 07-05 | ✅ 최종본 | 화재 소화조 배지를 최종 표준 이름 `대응`으로 확정. 이후 이 이름을 뒤집은 파일 없음 |
| `fix-badges-260705b.ts` | 07-05 | 🔁 중간본 | `지휘→총괄` 리네임 부분은 유효하나, "상황실 역할 삭제" 부분은 라이브 DB에 실제로 반영 안 됐던 것이 07-23에 발견됨(`history.md` §2) → `fix-badges-260723-dedup-situation-room.ts`가 다시 처리 |
| `fix-badges-260706.ts` | 07-06 | ✅ 최종본 | 배지명 표준 어휘 확정(총괄·통제·상황·출동·대응·유도·응급·방호·경계·복구·지원). 이후 모든 화재 임무 스크립트가 이 어휘를 그대로 사용 — 뒤집힌 적 없음 |
| `fix-badges-260723-dedup-situation-room.ts` | 07-23 | ✅ 최종본 | `260705b`가 못 지운 중복 역할(상황실/상황실화재) 실제 삭제 완료. `history.md`에 실행 완료 기록됨 |

## B. 화재 임무 내용 · variant(상황확정) 계열 (disaster_tasks, 화재 한정)

| 파일 | 날짜 | 분류 | 근거 |
|---|---|---|---|
| `fix-fire-variants-260708.ts` | 07-08 | 🔁 중간본 | 이 파일이 넣은 "가스구역" 8줄 버전은 같은 날 `fix-fire-scenario-variants`가 교체, 그것도 다음날 `fix-fire-day-pdf-260709`가 다시 5줄로 교체. "배터리" 임무 2건도 `fix-fire-scenario-variants`가 명시적으로 삭제("UPS실/지하주차장에 흡수되므로"). K급주방 태깅만 잔존 |
| `fire-scenario-variant-data.json` | 07-08 | (데이터 파일) | 마이그레이션이 아니라 `fix-fire-scenario-variants-260708.ts`가 참조하는 데이터. 그 스크립트와 운명을 같이함 |
| `fix-fire-scenario-variants-260708.ts` | 07-08 | 🔁 중간본 | 가스구역 8줄 버전은 `fix-fire-day-pdf-260709`가 5줄로 교체(파일 주석에 "기존 8줄짜리 상세판은 삭제"라고 명시). UPS실·지하주차장 추가분은 지금도 유효 |
| `fix-fire-day-pdf-260709.ts` | 07-09 | ✅ 최종본 | 총괄/통제/상황/출동(가스구역) PDF 기준 반영. 이후 이 내용을 뒤집은 파일 없음(단, 통제엔 UPS실/지하주차장이 아직 없어 `260713 parity`가 추가) |
| `fix-fire-control-parity-260713.ts` | 07-13 | ✅ 최종본 | 통제 배지에 출동과 동일한 UPS실·지하주차장·가스구역(신버전) 동기화. 이후 뒤집힌 적 없음 |
| `fix-fire-control-reorder-260713.ts` | 07-13 | ✅ 최종본 | 통제 배지 임무 순서 재배치(내용 변경 없음, 표시 순서만). 이후 순서를 다시 바꾼 파일 없음 |
| `fix-fire-situation-reclass-260713.ts` | 07-13 | ✅ 최종본 | 상황(day)/통제(night) 헤더를 4개 카테고리로 재분류. 이후 뒤집힌 적 없음 |

## C. 보안 (RLS)

| 파일 | 날짜 | 분류 | 근거 |
|---|---|---|---|
| `fix-rls-disabled-260715.sql` | 07-15 | 🔁 **절반만 적용 — 라이브 확인됨** | `npx supabase db query --linked`로 직접 확인. **운영 테이블**(`incidents`/`responders`/`member_tasks`/`push_subscriptions`)은 RLS 켜짐 + `inc_all`/`resp_all`/`mt_all`/`push_all`(전면허용) 정책까지 마이그레이션 의도 그대로 살아있음. 반면 **마스터 테이블**(`employees`/`employee_disaster_badges`/`disaster_roles`/`disaster_tasks`)은 정책 객체(`dr_write`/`emp_read`/`edb_read`/`dt_write`/`dt_read` 등)는 만들어진 채 남아있지만 **`rowsecurity=false`로 RLS 자체가 다시 꺼져있음** — 누군가 켰다가(정책까지 생성) `authenticated` 권한이 없어 AdminPanel/disa_app 쓰기가 막히자 다시 끈 것으로 보임. 정책 객체 자체는 죽은 채 방치돼 있어 정리해도 무방하나, 지금 당장 문제를 일으키진 않음 |

## D. TTS 전화 에스컬레이션 — 테이블/컬럼 (스키마)

| 파일 | 날짜 | 분류 | 근거 |
|---|---|---|---|
| `add-call-escalation-260716.sql` | 07-16 | 🔁 중간본 | `incidents.call_escalated_at` 컬럼은 `260716b`가 DROP. `incident_acks` 테이블 자체는 존속(이후 파일들이 컬럼만 추가) |
| `update-call-escalation-260716b.sql` | 07-16 | 🔁 중간본 | `incident_call_escalations` 테이블 생성은 유효/존속. `tts_call_enabled` 컬럼은 이후(§9, 07-24) 프론트에서 전부 제거되어 **사문화된 죽은 컬럼**으로 DB에만 남음 |
| `fix-escalation-bugs-260720.sql` | 07-20 | ✅ 최종본 | `incident_acks.mode` 컬럼 추가(이후 PK에 편입), `notify_dispatches` 테이블 생성(현재 `notify-incident` Edge Function이 실사용 중) |
| `fix-escalation-audit-260724.sql` | 07-24 | ✅ 최종본(적용 확인됨) | `history.md` §13("TTS 마이그레이션 전체 반영 확인 완료")에 실행 확인 기록. `incident_acks` PK를 `(incident_id,emp_no,mode)`로 변경, `incident_call_escalations` 감사 컬럼 추가, `incidents.night_duty_group` 추가 |
| `add-tts-emp-nos-260723.sql` | 07-23 | ✅ 최종본(적용 확인됨) | `history.md` §13에 실행 확인 기록 |
| `add-tts-must-call-260724.sql` | 07-24 | ✅ 최종본(적용 확인됨) | `history.md` §13에 실행 확인 기록 |
| `rename-tts-function-260724.sql` | 07-24 | 🔁 중간본 | 트리거가 새 함수 URL을 가리키도록 바꾼 것은 확인됨(§10). 함수 본문의 `pg_net.http_post(...)::text` 자체는 같은 날(7/24) 아래 b~f 과정으로 바로 수정됨 — **아래 실측 근거 참고**. 최신 유효본은 `fix-tts-trigger-260724f-final.sql` |

## E. TTS 트리거 복구 (2026-07-24, 훈련 당일 즉시 수정됨) — ✅ **해결 확인됨**

> 2026-07-26 세션에서 최초 작성 시 "미해결/g가 라이브에 남아있을 수 있음"이라고 적었으나,
> **`npx supabase db query --linked`로 라이브 DB를 직접 조회해 정정**합니다. 실측 근거:
> - `SELECT prosrc FROM pg_proc WHERE proname='notify_incident_call_escalation'` → 현재 함수
>   본문이 `net.http_post` + `jsonb` body, `RAISE WARNING` 없음 → **`f-final`과 정확히 일치**
>   (`g-debug2`가 아님 — 디버그 버전은 남아있지 않음)
> - `net._http_response` 전체 46건 조회 → **전부 2026-07-24 02:01~06:58(UTC), 전부
>   status_code=200·에러 없음** → 그날 훈련에서 실제로 정상 발신됐다는 사용자 확인과 일치

| 파일 | 분류 | 근거 |
|---|---|---|
| `fix-tts-trigger-260724b.sql` | 🔁 중간본 | pg_net 확장 확인 + 함수/트리거 재부착만 시도, 근본 원인 못 찾음 (같은 날 진행) |
| `fix-tts-trigger-260724c.sql` | 🔁 중간본 | `pg_net.http_post` → `net.http_post` 스키마 수정(원인 후보였으나 부족) |
| `fix-tts-trigger-260724d.sql` | 🔁 중간본 | `SECURITY DEFINER` 추가(원인 후보였으나 부족) |
| `fix-tts-trigger-260724e-debug.sql` | 🐞 디버그 전용 | 파일 자체 주석: "원인 확인 후 d로 되돌릴 것" — 운영용 아님, 정상적으로 지나감 |
| `fix-tts-trigger-260724f-final.sql` | ✅ **최종본 — 라이브 확인됨** | 진짜 원인(body `::text` 캐스팅 → `jsonb`) 수정. **현재 라이브 함수 본문과 실측 일치** |
| `fix-tts-trigger-260724g-debug2.sql` | 🐞 디버그 전용(정상적으로 되돌려짐) | 일시적으로 `RAISE WARNING` 진단판을 올렸으나, **라이브 확인 결과 지금은 f-final로 정상 복귀돼 있음** |

**결론**: 260716~7/23 사이의 옛 트리거 코드(`pg_net.http_post(...)::text`)는 실행됐다면 조용히 실패했을 가능성이 높지만(그 시기 성공 이력이 `net._http_response`에 전혀 없음 — 다만 pg_net 응답 로그의 보존기간 때문일 수도 있어 이 기간 자체를 "고장"이라 단정하진 않습니다), **7/24 당일 훈련 중 b→f 디버깅으로 바로 고쳐졌고, 그 이후 호출은 전부 성공했으며 지금도 정상판이 라이브에 유지되고 있음을 직접 확인했습니다.** "최근까지 한 번도 작동 안 했을 가능성"이라던 최초 진단은 틀렸습니다 — 정정합니다.

---

## 구조적으로 눈에 띈 문제 (분류와 별개로 참고만 하세요 — 지금 고치지 않았습니다)
- `notify_incident_call_escalation()` 트리거 함수는 **캐노니컬 원본 파일이 없고**, 지금까지 8개 파일(`260716`/`260716b`/`260724 rename`/`260724b~d,f,g`)이 각자 전체 함수 본문을 통째로 재정의해왔습니다. 다음에 이 함수를 또 고칠 일이 생기면, 매번 새 날짜 파일을 추가하기보다 "현재 유효한 함수 정의" 파일 하나(예: `_current/notify_incident_call_escalation.sql`)를 두고 그 파일을 갱신하는 방식이 이런 혼란을 줄일 수 있습니다.
- TTS 트리거·RLS 두 항목은 최초 작성 시 코드 정황만으로 추론했다가 실제와 달라 정정한 것입니다(`npx supabase db query --linked`로 직접 조회해 확인함, 아래 참고). **앞으로 이 문서의 다른 "❓불확실" 항목도, 실제 조치 전에는 반드시 이 방법으로 라이브 상태를 먼저 확인하세요** — SQL 파일 주석은 작성 시점의 가설/의도일 뿐 라이브 상태의 증거가 아닙니다.
