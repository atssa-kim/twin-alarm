-- ══════════════════════════════════════════════════════════════
-- TTS 발신 트리거 복구 (2026-07-24b)
--
-- 증상: incidents 발령/승격을 해도 incident_call_escalations에 아무 행도
-- 안 남음(전화가 전혀 안 감) — 함수(notify-tts-must-call) 자체는 직접 호출하면
-- 정상 동작하므로, DB 트리거가 아예 안 붙어있거나 트리거 안의 URL이 잘못돼 있는
-- 상태로 추정됨. 원인을 특정할 수 없어 아래에서 pg_net 활성화 확인 + 함수 재정의
-- (실제 URL/키로) + 트리거 재부착을 한 번에 전부 다시 실행함. 이미 정상이었어도
-- 안전하게 재실행 가능(멱등).
-- ══════════════════════════════════════════════════════════════

-- 1. pg_net 확장 활성화 확인(이미 있으면 무시됨)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. 트리거 함수 재정의 — 실제 프로젝트 URL·publishable key로 고정
CREATE OR REPLACE FUNCTION notify_incident_call_escalation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM pg_net.http_post(
      url     := 'https://hzqesdprnlpzaomaeswx.supabase.co/functions/v1/notify-tts-must-call',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_sX0tbsqpy2zdB-6n062V7g_0zzX1LHS'
      ),
      body    := (jsonb_build_object(
        'type',       TG_OP,
        'record',     row_to_json(NEW)::jsonb,
        'old_record', row_to_json(OLD)::jsonb
      ))::text
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

-- 3. 트리거 재부착 (없었으면 새로 생성, 있었으면 동일 정의로 교체)
DROP TRIGGER IF EXISTS on_incident_call_escalation ON public.incidents;
CREATE TRIGGER on_incident_call_escalation
  AFTER INSERT OR UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION notify_incident_call_escalation();

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인 (SQL Editor에서 실행)
-- ══════════════════════════════════════════════════════════════
-- 1) 트리거가 실제로 테이블에 붙어있는지:
--    SELECT tgname, tgrelid::regclass, tgenabled
--    FROM pg_trigger WHERE tgname = 'on_incident_call_escalation';
--
-- 2) pg_net이 최근에 이 URL로 요청을 보냈는지 (실행 이력):
--    SELECT id, status_code, created, url
--    FROM net._http_response ORDER BY created DESC LIMIT 5;
