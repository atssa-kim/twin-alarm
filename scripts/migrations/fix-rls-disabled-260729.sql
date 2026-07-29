-- ══════════════════════════════════════════════════════════════
-- Supabase 보안 경고 재발 대응 (2026-07-29) — "rls_disabled_in_public"
-- fix-rls-disabled-260715.sql로 4개 마스터 테이블에 RLS를 켜고 읽기 정책까지 만들어뒀는데,
-- 어느 시점에 disaster_roles/disaster_tasks/employees/employee_disaster_badges 4개 테이블만
-- RLS가 다시 꺼진 상태로 되돌아가 있었음(정책은 그대로 살아있어 무효화만 된 상태 —
-- history.md 2026-07-26 로그에서도 한 번 확인된 동일 패턴의 재발).
-- 추가로 alarms/missions/users 3개 테이블도 RLS가 꺼진 채 발견됐는데, 이 셋은 twin-alarm·
-- disa_app 코드 어디서도 참조되지 않는 사용하지 않는(초기 프로토타입 잔재로 추정) 테이블이라
-- 정책 없이 RLS만 켜서(=anon 전면 차단) 광고 경고를 해소함. 데이터/구조는 그대로 보존.
-- ══════════════════════════════════════════════════════════════

-- ① 마스터 테이블 — 정책은 이미 존재, RLS만 재활성화 (idempotent: 이미 켜져 있어도 안전)
ALTER TABLE public.disaster_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disaster_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_disaster_badges ENABLE ROW LEVEL SECURITY;

-- ② 미사용 테이블 — 코드에서 참조되지 않음(2026-07-29 grep 확인). 정책 없이 RLS만 켜서
--    anon 접근을 전면 차단(기존에도 실제로 쓰인 적 없으니 동작 영향 없음).
ALTER TABLE public.alarms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users    ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인 쿼리
-- ══════════════════════════════════════════════════════════════
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
