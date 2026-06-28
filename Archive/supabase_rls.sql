-- ══════════════════════════════════════════════════════════════
-- TwinTower Ops — Supabase Row Level Security (RLS) 설정
-- Supabase SQL Editor에서 실행하세요.
-- ══════════════════════════════════════════════════════════════
-- 목적:
--   • 마스터 테이블 (역할·임무·직원): anon key로 읽기 전용
--     → 대원이 임의로 임무·직원 데이터를 수정·삭제 불가
--     → 쓰기는 service_role key 전용 (disa_app·seed 스크립트)
--   • 운영 테이블 (사고·대원·임무체크): anon key CRUD 허용
--     → 발령·상태변경·체크리스트 수행은 앱 로직으로 통제
-- ══════════════════════════════════════════════════════════════

-- ① 마스터 테이블 — 읽기 전용 (anon)
-- ──────────────────────────────────────
ALTER TABLE public.disaster_roles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disaster_tasks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_disaster_badges ENABLE ROW LEVEL SECURITY;

-- SELECT: 모든 요청 허용 (앱 조회용)
CREATE POLICY "dr_read"  ON public.disaster_roles   FOR SELECT USING (true);
CREATE POLICY "dt_read"  ON public.disaster_tasks   FOR SELECT USING (true);
CREATE POLICY "emp_read" ON public.employees        FOR SELECT USING (true);
CREATE POLICY "edb_read" ON public.employee_disaster_badges FOR SELECT USING (true);
-- INSERT/UPDATE/DELETE 정책 없음 → anon key는 쓰기 불가
-- service_role key는 RLS를 자동 우회 → seed·disa_app은 정상 작동

-- ② 운영 테이블 — CRUD 허용 (anon, 앱 로직으로 통제)
-- ──────────────────────────────────────────────────────
ALTER TABLE public.incidents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inc_all"  ON public.incidents    USING (true) WITH CHECK (true);
CREATE POLICY "resp_all" ON public.responders   USING (true) WITH CHECK (true);
CREATE POLICY "mt_all"   ON public.member_tasks USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인 쿼리
-- ══════════════════════════════════════════════════════════════
-- SELECT schemaname, tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, cmd;
