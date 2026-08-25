-- ══════════════════════════════════════════════════════════════
-- 재난편제표 배지 카드 순서를 관리자가 직접 정렬할 수 있게 함 (2026-08-25)
-- sort_order가 없는(NULL) 행은 기존처럼 id 순으로 정렬되므로 실행 전/후로 화면이 깨지지 않음.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.disaster_roles
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- 기존 행에 현재 표시 순서(=id 순) 그대로 초기값 채우기 — 10 간격으로 나중에 끼워넣을 여유를 둠
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY disaster, shift ORDER BY id) * 10 AS rn
  FROM public.disaster_roles
)
UPDATE public.disaster_roles r
SET sort_order = ranked.rn
FROM ranked
WHERE r.id = ranked.id;

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT disaster, shift, badge, sort_order FROM public.disaster_roles WHERE disaster = '화재' ORDER BY shift, sort_order;
