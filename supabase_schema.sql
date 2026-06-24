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
