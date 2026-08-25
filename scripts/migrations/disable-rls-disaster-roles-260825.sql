-- ══════════════════════════════════════════════════════════════
-- disaster_roles RLS 비활성화 (2026-08-25)
-- 재난편제표 배지 카드 드래그 정렬(sort_order 업데이트)이 RLS에 막혀 있었음.
-- postgrest는 RLS로 막힌 UPDATE를 에러 없이 "0건 반영"으로 응답해서, 화면엔 잠깐
-- 바뀐 것처럼 보였다가 새로고침하면 조용히 원래 순서로 되돌아가는 증상으로 나타났음.
-- employees / employee_disaster_badges에 이미 적용한 것과 동일한 조치.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.disaster_roles DISABLE ROW LEVEL SECURITY;
