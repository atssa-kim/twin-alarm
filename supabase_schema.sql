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
