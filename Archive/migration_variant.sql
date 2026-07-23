-- 화재 대응 variant(상황 확정) 기능 — 2026-07-08
-- Supabase SQL Editor에서 1회 실행하세요. 실행 후 scripts/fix-fire-variants-260708.ts 로
-- 화재 조건부 임무(K급주방/가스구역)에 variant 태그를 붙이고 배터리 임무를 추가합니다.
--
-- variant 값 의미: null = 상시 표시되는 공통 임무. 값이 있으면 incidents.variant(또는
-- member_tasks.variant)가 그 값과 일치할 때만 화면에 표시됩니다.

ALTER TABLE public.disaster_tasks ADD COLUMN IF NOT EXISTS variant TEXT;  -- null = 공통
ALTER TABLE public.member_tasks   ADD COLUMN IF NOT EXISTS variant TEXT;  -- 발령 시 disaster_tasks.variant를 그대로 복사
ALTER TABLE public.incidents      ADD COLUMN IF NOT EXISTS variant TEXT;  -- null = 상황 미확정(공통만 표시)
