-- ══════════════════════════════════════════════════════════════
-- 코드 리뷰로 발견된 버그 수정 (2026-07-20)
-- 1. incident_acks에 mode 저장 — 감지기동작 단계에서 확인한 게 전체화재
--    승격 이후까지 "확인됨"으로 잘못 인정되지 않도록 함.
-- 2. notify_dispatches(incident_id, mode) — CommanderDashboard의 직접 호출과
--    on_incident_fcm DB 트리거가 항상 동시에 notify-incident를 호출해서
--    push/SMS/알림톡이 매 발령·승격마다 두 번씩 나가던 문제 방지.
-- Supabase SQL Editor에서 1회 실행하세요.
-- ══════════════════════════════════════════════════════════════

-- 1. incident_acks에 mode 컬럼 추가 (PK는 그대로 incident_id,emp_no — upsert 시 갱신됨)
ALTER TABLE public.incident_acks ADD COLUMN IF NOT EXISTS mode text;

-- 2. notify-incident 중복 발송 방지 테이블
--    앱(anon key)이 직접 건드릴 일이 없으므로 RLS만 켜두고 정책은 추가하지 않음
--    (service_role을 쓰는 Edge Function만 접근 가능 — RLS는 자동 우회됨)
CREATE TABLE IF NOT EXISTS public.notify_dispatches (
  incident_id   text NOT NULL,
  mode          text NOT NULL,
  dispatched_at bigint NOT NULL,
  PRIMARY KEY (incident_id, mode)
);
ALTER TABLE public.notify_dispatches ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'incident_acks' AND column_name = 'mode';
-- SELECT * FROM pg_policies WHERE tablename = 'notify_dispatches'; -- 정책 없음이 정상
