-- ══════════════════════════════════════════════════════════════
-- TTS 발신 트리거 복구 (2026-07-24d) — SECURITY DEFINER 누락 수정
--
-- 260716부터 트리거 함수가 SECURITY INVOKER(기본값)로 정의돼 있었음.
-- SQL Editor(관리자 권한)에서 net.http_post를 직접 호출하면 성공(확인됨,
-- status_code=200)하지만, 실제 발령은 앱이 anon 권한으로 incidents에
-- INSERT/UPDATE 하면서 트리거를 발동시키므로, 트리거 함수도 그 호출자인
-- anon 권한으로 실행됨 → anon에게 net.http_post 실행 권한이 없어 매번
-- 에러 → 트리거 본문의 EXCEPTION 핸들러가 조용히 삼킴(진단: 직접 호출은
-- 성공, 트리거 경유는 net._http_response에 기록이 전혀 안 남음).
-- SECURITY DEFINER를 추가해 "함수를 만든 사람(관리자)" 권한으로 항상
-- 실행되도록 고침 — search_path도 함께 고정해 보안 관례를 지킴.
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
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;
-- 트리거 자체(on_incident_call_escalation)는 이미 정상 부착·활성 상태이므로
-- 재부착 불필요 — 함수 본문(SECURITY DEFINER 추가)만 교체하면 됨.

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인 (SQL Editor에서 실행)
-- ══════════════════════════════════════════════════════════════
-- 아래로 진짜 발령 흉내(테스트) INSERT 후 확인:
-- INSERT INTO incidents (id, disaster, location, status, declared_at, declared_by, mode, scope, shift, tts_call_enabled)
-- VALUES ('sql_test_1', '화재', 'SQL테스트', 'active', extract(epoch from now())*1000, 'E-4001', '훈련/SQL테스트', 'fire_initial', 'day', true);
--
-- SELECT * FROM net._http_response ORDER BY id DESC LIMIT 1;  -- 새 응답이 생겼는지
--
-- UPDATE incidents SET status = 'closed' WHERE id = 'sql_test_1';  -- 정리
