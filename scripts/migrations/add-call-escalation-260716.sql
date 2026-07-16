-- ══════════════════════════════════════════════════════════════
-- TTS 전화 에스컬레이션 (2026-07-16)
-- "실제 상황" 발령 후 30초가 지나도 앱을 열어보지 않은 지휘연락급
-- (총괄/통제/상황 배지) 대상자에게만 SOLAPI 보이스(TTS) 전화를 겁니다.
-- 훈련(mode가 '훈련'으로 시작)은 대상에서 제외됩니다.
-- Supabase SQL Editor에서 1회 실행하세요.
-- ══════════════════════════════════════════════════════════════

-- 1. 재난 알림 확인(앱을 열어본) 기록 테이블
CREATE TABLE IF NOT EXISTS public.incident_acks (
  incident_id text NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  emp_no      text NOT NULL,
  acked_at    bigint NOT NULL,
  PRIMARY KEY (incident_id, emp_no)
);
ALTER TABLE public.incident_acks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ack_all" ON public.incident_acks;
-- 로그인 시스템이 없는 twin-alarm 특성상 다른 운영 테이블(incidents/responders 등)과
-- 동일하게 anon key로 전체 CRUD 허용 (앱 로직으로 통제).
CREATE POLICY "ack_all" ON public.incident_acks USING (true) WITH CHECK (true);

-- 2. 같은 사건에 전화 에스컬레이션이 중복 실행되지 않도록 막는 플래그
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS call_escalated_at bigint;

-- 3. 발령(INSERT) 시 escalate-unacked-calls 함수 트리거
--    [PROJECT_REF] 와 [ANON_KEY] 를 실제 값으로 교체 후 실행하세요.
--    (기존 on_incident_fcm 트리거와 별도로 동작 — FCM 발송 로직은 건드리지 않습니다)
CREATE OR REPLACE FUNCTION notify_incident_call_escalation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM pg_net.http_post(
      url     := 'https://[PROJECT_REF].supabase.co/functions/v1/escalate-unacked-calls',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer [ANON_KEY]'
      ),
      body    := (jsonb_build_object(
        'type',   TG_OP,
        'record', row_to_json(NEW)::jsonb
      ))::text
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_incident_call_escalation ON public.incidents;
CREATE TRIGGER on_incident_call_escalation
  AFTER INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION notify_incident_call_escalation();

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT * FROM pg_policies WHERE tablename = 'incident_acks';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'call_escalated_at';
