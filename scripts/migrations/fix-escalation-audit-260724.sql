-- ══════════════════════════════════════════════════════════════
-- TTS 에스컬레이션 코드 리뷰로 발견된 문제 일괄 수정 (2026-07-24)
-- Supabase SQL Editor에서 1회 실행하세요. 전부 idempotent(재실행 안전).
-- ══════════════════════════════════════════════════════════════

-- 1. incident_acks: PK가 (incident_id, emp_no)뿐이라 mode가 바뀔 때마다(감지기동작→
--    전체화재 승격 등) 기존 확인 기록이 새 mode로 덮어써짐 — 앱이 열려있기만 해도
--    사람이 아무것도 안 했는데 새 단계가 자동으로 "확인됨" 처리되던 버그.
--    PK에 mode를 포함시켜 단계별로 별도 행이 남도록 수정.
UPDATE public.incident_acks SET mode = '' WHERE mode IS NULL;
ALTER TABLE public.incident_acks ALTER COLUMN mode SET DEFAULT '';
ALTER TABLE public.incident_acks ALTER COLUMN mode SET NOT NULL;
ALTER TABLE public.incident_acks DROP CONSTRAINT IF EXISTS incident_acks_pkey;
ALTER TABLE public.incident_acks ADD PRIMARY KEY (incident_id, emp_no, mode);

-- 2. incident_call_escalations: 실패해도 아무 기록도 안 남고 재시도도 없어 완전히
--    조용히 사라지던 문제 — 결과/에러를 남길 수 있는 컬럼 추가.
--    scope도 추가해서 "감지기동작 단계를 이미 거쳤는지" 판정을 mode 문자열
--    LIKE '%감지기%' 매칭 대신 scope='fire_initial' 값 비교로 바꿀 수 있게 함.
ALTER TABLE public.incident_call_escalations
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS must_call_count int,
  ADD COLUMN IF NOT EXISTS target_count int,
  ADD COLUMN IF NOT EXISTS called_count int,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS completed_at bigint;

-- 3. incidents: 화재 야간 발령 시 "오늘 야간 근무조(A/B/C/D)"를 지정할 수 있게.
--    지정되면 TTS 대상을 그 조 소속(employees.shift_group)으로만 좁혀서, 비번인
--    나머지 3개조에는 전화가 안 가도록 함.
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS night_duty_group text;

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.incident_acks'::regclass AND contype = 'p';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'incident_call_escalations' AND column_name IN ('scope','error','called_count');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'night_duty_group';
