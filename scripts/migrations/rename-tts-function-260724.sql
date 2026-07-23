-- ══════════════════════════════════════════════════════════════
-- TTS Edge Function 이름 변경 반영 (2026-07-24)
-- escalate-unacked-calls → notify-tts-must-call
-- ("30초 미확인자 에스컬레이션" 로직을 완전히 삭제하고 나니 옛 이름이 실제 동작과
--  안 맞아서 정리. 기능은 100% 동일 — 트리거가 호출하는 URL만 새 함수로 바뀜)
--
-- 새 함수는 이미 배포됨(supabase functions deploy notify-tts-must-call).
-- 이 SQL을 실행해야 실제로 incidents 발령/승격 시 새 함수가 호출됩니다.
-- 실행 전까지는 기존 escalate-unacked-calls가 계속 호출되므로(아직 배포된 상태 유지 중)
-- TTS 전화가 끊기지 않습니다 — 이 SQL 실행 후에 옛 함수를 삭제해도 안전합니다.
-- ══════════════════════════════════════════════════════════════

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
-- 트리거 이름·연결 함수(notify_incident_call_escalation)는 그대로 — 내부 URL만 교체됐으므로
-- DROP/CREATE TRIGGER는 불필요(함수 본문만 CREATE OR REPLACE로 갱신).

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT prosrc FROM pg_proc WHERE proname = 'notify_incident_call_escalation';
-- (결과에 notify-tts-must-call이 보이면 성공)
--
-- 확인되면 옛 함수 삭제(선택, 터미널에서):
--   npx supabase functions delete escalate-unacked-calls
