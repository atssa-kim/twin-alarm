-- ══════════════════════════════════════════════════════════════
-- TTS 발신 트리거 최종 수정 (2026-07-24f) — 진짜 원인: body 타입 오류
--
-- Postgres 로그로 실제 에러를 확인함:
--   function net.http_post(url => unknown, headers => jsonb, body => text)
--   does not exist (SQLSTATE 42883)
-- net.http_post의 body 파라미터는 jsonb인데, 트리거 코드가 계속
-- (...)::text로 문자열 캐스팅해서 보내고 있었음(2026-07-16 최초
-- 마이그레이션부터 존재하던 버그). 이전 진단(SECURITY DEFINER, 권한 등)은
-- 전부 정상이었고 실제 원인이 아니었음 — 이번 수정이 최종본.
--
-- 2026-07-24e(디버그용 RAISE WARNING 버전)를 대체 — 에러는 다시 조용히
-- 삼키는 운영 모드로 되돌리고, body 캐스팅만 jsonb로 교정.
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
      body    := jsonb_build_object(
        'type',       TG_OP,
        'record',     row_to_json(NEW)::jsonb,
        'old_record', row_to_json(OLD)::jsonb
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT * FROM net._http_response ORDER BY id DESC LIMIT 1;
-- (직접 발령/테스트 INSERT 후 새 행이 생기면 완전히 해결된 것)
