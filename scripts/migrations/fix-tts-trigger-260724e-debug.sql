-- ══════════════════════════════════════════════════════════════
-- TTS 트리거 진단용 임시 버전 (2026-07-24e) — 에러를 숨기지 않고 로그에 남김
--
-- 지금까지 SECURITY DEFINER·권한·트리거 바인딩을 전부 확인했는데도 원인이
-- 안 잡혀서, EXCEPTION WHEN OTHERS THEN NULL을 잠시 제거하고 RAISE WARNING
-- 으로 실제 에러 메시지를 Postgres 로그(Supabase 대시보드 → Logs →
-- Postgres Logs)에 남기도록 임시로 바꿈. 원인 확인 후 fix-tts-trigger-260724d.sql
-- 버전(정상 운영용, 에러 삼킴)으로 되돌릴 것.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notify_incident_call_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
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
    RAISE WARNING 'TTS_DEBUG: net.http_post 호출 성공, op=%, incident_id=%', TG_OP, NEW.id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'TTS_DEBUG: net.http_post 호출 실패 — %  (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- 적용 후: 지휘본부에서 아무 재난이나 발령(또는 위와 같은 테스트 INSERT) →
-- Supabase 대시보드 → Logs → Postgres Logs 에서 "TTS_DEBUG"로 검색.
