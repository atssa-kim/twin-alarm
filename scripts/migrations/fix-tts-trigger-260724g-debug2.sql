-- ══════════════════════════════════════════════════════════════
-- TTS 트리거 진단용 임시 버전 2 (2026-07-24g) — jsonb 수정 + 에러 로그 유지
-- body::text 버그를 고친 뒤에도 여전히 net._http_response에 새 행이 안 생겨서,
-- 진짜로 성공/실패 여부를 로그로 다시 확인하기 위한 버전. 확인 후
-- fix-tts-trigger-260724f-final.sql(에러 삼킴, 운영용)로 되돌릴 것.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notify_incident_call_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  req_id bigint;
BEGIN
  BEGIN
    req_id := net.http_post(
      url     := 'https://hzqesdprnlpzaomaeswx.supabase.co/functions/v1/notify-tts-must-call',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_sX0tbsqpy2zdB-6n062V7g_0zzX1LHS'
      ),
      body    := jsonb_build_object(
        'type',       TG_OP,
        'record',     row_to_json(NEW)::jsonb,
        'old_record', row_to_json(OLD)::jsonb
      )
    );
    RAISE WARNING 'TTS_DEBUG2: 성공, req_id=%, op=%, incident_id=%', req_id, TG_OP, NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'TTS_DEBUG2: 실패 — %  (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;
