-- ══════════════════════════════════════════════════════════════
-- TTS 발신 트리거 복구 (2026-07-24c) — pg_net 스키마 오류 수정
--
-- 260716부터 지금까지 트리거 함수가 pg_net.http_post(...)를 호출했는데,
-- 실제 pg_net 확장은 함수를 net 스키마에 만든다(net.http_post). 존재하지
-- 않는 함수를 부르니 매번 에러가 났지만, 트리거 본문의
-- "EXCEPTION WHEN OTHERS THEN NULL"이 그 에러를 조용히 삼켜서 겉으로는
-- 트리거가 "정상 실행"된 것처럼 보이고 실제 HTTP 요청은 단 한 번도 안 나간
-- 상태였음(진단: net._http_response에 기록이 전혀 없음, tgenabled='O'로
-- 트리거 자체는 정상 부착·활성 확인됨). pg_net → net으로 스키마만 교정.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION notify_incident_call_escalation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
-- 트리거는 이미 정상 부착·활성 상태로 확인됐으므로 재부착 불필요(함수 본문만 교체).

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인 (SQL Editor에서 실행)
-- ══════════════════════════════════════════════════════════════
-- 컬럼명을 모르니 전체를 봅니다:
-- SELECT * FROM net._http_response ORDER BY id DESC LIMIT 5;
