-- 🏢 트윈타워 상황대응 시스템 (TwinTower Ops) - Supabase 테이블 스키마
-- Supabase SQL Editor에 복사하여 붙여넣고 실행해 주세요.

-- 1. incidents (사고 정보 테이블)
CREATE TABLE IF NOT EXISTS public.incidents (
    id TEXT PRIMARY KEY,
    disaster TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
    declared_at BIGINT NOT NULL,
    declared_by TEXT NOT NULL,
    mode TEXT NOT NULL,
    scope TEXT NOT NULL
);

-- 2. responders (대원 출동 상태 테이블)
CREATE TABLE IF NOT EXISTS public.responders (
    incident_id TEXT NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    emp_no TEXT NOT NULL,
    name TEXT NOT NULL,
    team TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('미응답', '출동중', '현장', '복귀')),
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (incident_id, emp_no)
);

-- 3. member_tasks (실시간 임무 체크리스트 테이블)
CREATE TABLE IF NOT EXISTS public.member_tasks (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    emp_no TEXT,
    role TEXT NOT NULL,
    task_idx INTEGER NOT NULL,
    label TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    done_by TEXT,
    updated_at BIGINT
);

-- 4. 실시간 동기화(Realtime) 활성화
-- Supabase에서 Realtime 기능이 테이블 변경 내용을 즉시 프론트엔드로 스트리밍하도록 설정합니다.
BEGIN;
  -- 기존 publication에 테이블 추가
  ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.responders;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.member_tasks;
COMMIT;

-- 5. 개발 편의를 위한 행 수준 보안(RLS) 임시 해제
-- RLS를 켜고 정책을 지정하는 대신, 모바일 대피 훈련/데모 환경이므로 RLS를 비활성화합니다.
ALTER TABLE public.incidents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.responders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_tasks DISABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────
-- 재난 역할·임무 마스터 데이터 (disa_app 관리)
-- ──────────────────────────────────────────────

-- 4. disaster_roles (재난 유형별 역할 정의)
CREATE TABLE IF NOT EXISTS public.disaster_roles (
    id          SERIAL PRIMARY KEY,
    disaster    TEXT NOT NULL,       -- 'incidents.disaster' 와 일치
    group_name  TEXT,                -- '지휘', '대응반' 등 반 구분
    role        TEXT NOT NULL,       -- 역할 전체 이름
    badge       TEXT NOT NULL,       -- 로그인 badge 와 매칭 키
    bc          TEXT,                -- 뱃지 색상 코드
    UNIQUE(disaster, badge)
);

-- 5. disaster_tasks (역할별 임무 항목)
CREATE TABLE IF NOT EXISTS public.disaster_tasks (
    id          SERIAL PRIMARY KEY,
    role_id     INT NOT NULL REFERENCES public.disaster_roles(id) ON DELETE CASCADE,
    task_idx    INT NOT NULL,        -- 표시 순서
    label       TEXT NOT NULL
);

ALTER TABLE public.disaster_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.disaster_tasks DISABLE ROW LEVEL SECURITY;

-- 6. employees (직원 명부)
CREATE TABLE IF NOT EXISTS public.employees (
    emp_no       TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    team         TEXT NOT NULL,   -- '소방파트', '전기파트', '보안1', '보안2', '보안3' 등
    role         TEXT NOT NULL,   -- '파트장', '파트원', '센터장' 등
    is_commander BOOLEAN DEFAULT false,
    email        TEXT,
    phone        TEXT
);

-- 7. employee_disaster_badges (직원별 재난 배지 매핑)
--    team 기반 자동 계산이 아닌, 개인별로 명시 저장하여 예외도 처리 가능
CREATE TABLE IF NOT EXISTS public.employee_disaster_badges (
    emp_no   TEXT NOT NULL REFERENCES public.employees(emp_no) ON DELETE CASCADE,
    disaster TEXT NOT NULL,   -- '화재','정전','누수','태풍/홍수','폭설','지진','가스누출','승강기','테러'
    badge    TEXT NOT NULL,   -- disaster_roles.badge 와 일치해야 역할·임무가 연결됨
    PRIMARY KEY (emp_no, disaster)
);

ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_disaster_badges DISABLE ROW LEVEL SECURITY;

-- 8. push_subscriptions (FCM 푸시 토큰 저장 — 로그아웃 후에도 알람 수신)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    emp_no    TEXT NOT NULL,
    fcm_token TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (emp_no, fcm_token),
    UNIQUE (fcm_token)
);

ALTER TABLE public.push_subscriptions DISABLE ROW LEVEL SECURITY;

-- 9. 훈련 선택 대원 필터링용 컬럼 (전체훈련 승격 시 특정 emp_no 에만 FCM)
-- Supabase SQL Editor 에서 한 번 실행하세요.
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS drill_emp_nos TEXT DEFAULT NULL;

-- 10-1. duty_matrix (재난×근무×반×배지×부서 임무 매트릭스 — "일원화" 마스터, 2026-07-03)
--     원본: 트윈타워_재난대응_조직도_일원화_260703.pdf 를 그대로 옮긴 표 (scripts/seed-duty-matrix.ts 로 적재)
--     주의: 아직 employees/employee_disaster_badges 와 자동 연동되지 않은 조회 전용 마스터입니다.
--           지휘연락반(주간, 9개 재난 전체 통일) 배지는 총괄=센터장/통제=재난별 파트장/상황=상황실 3분류로 확정(2026-07-04).
--           그 외 배지 체계가 기존 disaster_roles.badge 와 다를 수 있어, 실시간 임무 배정
--           (ResponderView/CommanderDashboard)에 연결하려면 disa_app 쪽 정합 작업이 별도로 필요합니다.
CREATE TABLE IF NOT EXISTS public.duty_matrix (
    id         SERIAL PRIMARY KEY,
    disaster   TEXT NOT NULL,        -- incidents.disaster / employee_disaster_badges.disaster 와 동일 key 체계
    controller TEXT,                 -- 통제자(주간) 직책명, 예: '소방파트장'
    shift      TEXT NOT NULL CHECK (shift IN ('주간', '야간')),
    division   TEXT NOT NULL,        -- 반: 지휘연락반(9개 재난×주간/야간 통일, 가운뎃점 없음) /
                                      --     현장대응반 / 대피유도반 / 대피·지원반 / 지원반
    badge      TEXT NOT NULL,        -- 조(Badge): 상황 / 조치 / 복구 / 유도 / 응급 / 경계 / 출동 / 방호 / 관리 등
    dept_code  TEXT                  -- 부서구분: 소방/전기/기계/건축1/건축2/보안1/보안2/야전기/교대전기 등 (PDF 미기재 시 NULL)
);
CREATE INDEX IF NOT EXISTS idx_duty_matrix_lookup ON public.duty_matrix(disaster, shift, dept_code);
ALTER TABLE public.duty_matrix DISABLE ROW LEVEL SECURITY;

-- 10-2. employees 세분화 컬럼 — 부서구분(dept_code)·교대조(shift_group)
--     dept_code: duty_matrix.dept_code 매칭용, team보다 세분화 (예: 건축파트→건축현장/건축사무 구분,
--                교대 상황실 인원→야전기/교대전기 등). 아직 값이 채워지지 않았다면 team으로 대체 사용.
--     shift_group: NULL(상시주간) | 'A' | 'B' | 'C' | 'D' — role 텍스트의 "(A조·...)" 패턴을 정식 컬럼화
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS dept_code TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS shift_group TEXT;

-- 11. disaster_roles 에 shift(근무구분) 컬럼 추가 (2026-07-05)
--     배경: disa_app은 화재만 주간/야간/상황실(BMS) 3개 화면을 갖고 있는데, 기존엔
--     UNIQUE(disaster, badge) 제약 때문에 야간·BMS 화면의 badge(예: '통제')가 주간의
--     같은 이름 badge와 DB에서 같은 행을 가리켜서, disa_app이 야간/BMS 임무를 편집해도
--     twin-alarm에 자동 반영되도록 두면 주간 데이터를 덮어쓸 위험이 있었음 — 그래서
--     disa_app 쪽에서 야간/BMS 저장을 의도적으로 막아뒀었고, 이게 "disa_app 수정이
--     twin-alarm에 반영 안 되는" 원인이었습니다.
--     조치: shift 컬럼(day|night|bms)을 추가해 같은 이름의 badge라도 근무별로 다른 행으로
--     분리 저장. 기존 행은 전부 shift='day'로 채워지고, twin-alarm 실행 로직
--     (getDisasterRolesWithTasks 등)은 shift='day' 행만 조회하도록 코드도 함께 수정했으므로
--     이 마이그레이션 자체만으로는 기존 발령·임무배정 동작이 바뀌지 않습니다.
ALTER TABLE public.disaster_roles ADD COLUMN IF NOT EXISTS shift TEXT NOT NULL DEFAULT 'day';
ALTER TABLE public.disaster_roles DROP CONSTRAINT IF EXISTS disaster_roles_disaster_badge_key;
ALTER TABLE public.disaster_roles ADD CONSTRAINT disaster_roles_disaster_shift_badge_key UNIQUE (disaster, shift, badge);

-- 12. incidents 에 shift(근무구분) 컬럼 추가 (2026-07-05)
--     화재만 주간/야간 임무가 다르므로(11번 항목), 실제 발령 시 어느 shift의 disaster_roles를
--     쓸지 알아야 합니다. 자동 시각판정 대신 지휘관이 발령 화면에서 주간/야간을 직접 선택하도록
--     함(휴일 판정 등 부정확한 자동화를 피하기 위한 의도적 선택 — 2026-07-05 결정).
--     기존 행은 전부 shift='day'로 채워지며, 화재 외 재난은 항상 'day' 고정이라
--     이 마이그레이션 자체만으로는 기존 발령 동작이 바뀌지 않습니다.
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS shift TEXT NOT NULL DEFAULT 'day';

-- 10. FCM 알람 트리거 (pg_net 확장 필요 — Dashboard → Database → Extensions → pg_net 활성화)
--     [PROJECT_REF] 와 [ANON_KEY] 를 실제 값으로 교체 후 실행
-- CREATE OR REPLACE FUNCTION notify_incident_fcm()
-- RETURNS TRIGGER LANGUAGE plpgsql AS $$
-- BEGIN
--   BEGIN
--     PERFORM pg_net.http_post(
--       url     := 'https://[PROJECT_REF].supabase.co/functions/v1/notify-incident',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer [ANON_KEY]'
--       ),
--       body    := (jsonb_build_object(
--         'type',       TG_OP,
--         'record',     row_to_json(NEW)::jsonb,
--         'old_record', row_to_json(OLD)::jsonb
--       ))::text
--     );
--   EXCEPTION WHEN OTHERS THEN NULL;
--   END;
--   RETURN NEW;
-- END;
-- $$;
-- DROP TRIGGER IF EXISTS on_incident_fcm ON public.incidents;
-- CREATE TRIGGER on_incident_fcm
--   AFTER INSERT OR UPDATE ON public.incidents
--   FOR EACH ROW EXECUTE FUNCTION notify_incident_fcm();
