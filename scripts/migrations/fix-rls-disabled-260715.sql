-- ══════════════════════════════════════════════════════════════
-- Supabase 보안 경고 대응 (2026-07-15) — "Table publicly accessible"
-- RLS(Row Level Security)가 꺼져 있어 anon key만으로 disaster_roles 등
-- 9개 테이블 전체를 누구나 읽기/쓰기/삭제할 수 있는 상태였음.
-- Supabase SQL Editor에서 이 파일 전체를 1회 실행하세요.
--
-- 배경: Archive/supabase_rls.sql(마스터 테이블 읽기전용 + 운영 테이블 anon CRUD)과
-- disa_app/supabase_auth_setup.sql(disaster_roles/tasks 쓰기를 app_admins/
-- disaster_editors 기준으로 제한)이 이미 설계돼 있었지만, RLS를 켜는 ALTER TABLE
-- 자체가 실행된 적이 없어 두 파일의 정책이 전부 무효 상태였음. app_admins/
-- disaster_editors 테이블은 이미 RLS가 정상 적용돼 있어(직접 확인됨) 이 파일에서
-- 건드리지 않음.
-- 모든 정책은 DROP POLICY IF EXISTS로 감싸 재실행해도 안전(idempotent).
-- ══════════════════════════════════════════════════════════════

-- ① 마스터 테이블 — anon은 읽기 전용, 직원 명부/재난 임무 매트릭스
--    ─────────────────────────────────────────────────────────
ALTER TABLE public.disaster_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disaster_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_disaster_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_matrix              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dr_read"  ON public.disaster_roles;
DROP POLICY IF EXISTS "dt_read"  ON public.disaster_tasks;
DROP POLICY IF EXISTS "emp_read" ON public.employees;
DROP POLICY IF EXISTS "edb_read" ON public.employee_disaster_badges;
DROP POLICY IF EXISTS "dm_read"  ON public.duty_matrix;

CREATE POLICY "dr_read"  ON public.disaster_roles           FOR SELECT USING (true);
CREATE POLICY "dt_read"  ON public.disaster_tasks           FOR SELECT USING (true);
CREATE POLICY "emp_read" ON public.employees                FOR SELECT USING (true);
CREATE POLICY "edb_read" ON public.employee_disaster_badges FOR SELECT USING (true);
CREATE POLICY "dm_read"  ON public.duty_matrix               FOR SELECT USING (true);
-- INSERT/UPDATE/DELETE 정책 없음 → anon key는 이 5개 테이블에 쓰기 불가.
-- service_role key(seed 스크립트)는 RLS를 자동 우회하므로 seed/fix-badges는 그대로 동작.

-- disaster_roles/disaster_tasks는 예외적으로 로그인한 마스터(app_admins) 또는
-- 담당 재난의 파트장(disaster_editors)만 쓰기 허용 (disa_app 임무 편집 화면용).
DROP POLICY IF EXISTS "dr_write" ON public.disaster_roles;
CREATE POLICY "dr_write" ON public.disaster_roles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.disaster_editors e
      WHERE e.user_id = auth.uid() AND e.disaster = disaster_roles.disaster
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.disaster_editors e
      WHERE e.user_id = auth.uid() AND e.disaster = disaster_roles.disaster
    )
  );

DROP POLICY IF EXISTS "dt_write" ON public.disaster_tasks;
CREATE POLICY "dt_write" ON public.disaster_tasks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.disaster_roles r
      JOIN public.disaster_editors e ON e.disaster = r.disaster AND e.user_id = auth.uid()
      WHERE r.id = disaster_tasks.role_id
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.disaster_roles r
      JOIN public.disaster_editors e ON e.disaster = r.disaster AND e.user_id = auth.uid()
      WHERE r.id = disaster_tasks.role_id
    )
  );

-- ② 운영 테이블 — twin-alarm에 로그인 시스템이 없어 anon key로 CRUD해야
--    앱이 동작함. RLS는 켜되 기존 동작을 그대로 유지하는 전면 허용 정책.
--    ─────────────────────────────────────────────────────────
ALTER TABLE public.incidents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inc_all"  ON public.incidents;
DROP POLICY IF EXISTS "resp_all" ON public.responders;
DROP POLICY IF EXISTS "mt_all"   ON public.member_tasks;
DROP POLICY IF EXISTS "push_all" ON public.push_subscriptions;

CREATE POLICY "inc_all"  ON public.incidents           USING (true) WITH CHECK (true);
CREATE POLICY "resp_all" ON public.responders          USING (true) WITH CHECK (true);
CREATE POLICY "mt_all"   ON public.member_tasks        USING (true) WITH CHECK (true);
CREATE POLICY "push_all" ON public.push_subscriptions  USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인 쿼리
-- ══════════════════════════════════════════════════════════════
-- SELECT schemaname, tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, cmd;
