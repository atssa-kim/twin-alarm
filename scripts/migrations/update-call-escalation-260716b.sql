-- ══════════════════════════════════════════════════════════════
-- TTS 전화 에스컬레이션 개선 (2026-07-16b)
-- 1. 발령 시 "TTS 전화 사용" 체크박스 → incidents.tts_call_enabled
-- 2. 화재 감지기동작(1.1)→전체화재(1.2) 승격은 INSERT가 아니라 UPDATE라서
--    기존 AFTER INSERT 트리거로는 안 잡힘 → AFTER INSERT OR UPDATE로 변경
-- 3. 같은 incident가 1.1/1.2 두 번 에스컬레이션될 수 있으므로, 기존
--    incidents.call_escalated_at(재난당 1회) 대신 (incident_id, mode) 단위로
--    중복을 막는 incident_call_escalations 테이블로 교체
-- add-call-escalation-260716.sql을 먼저 실행한 뒤 이 파일을 실행하세요.
-- ══════════════════════════════════════════════════════════════

-- 1. 발령 시 TTS 전화 사용 여부 (기본값 true — 체크 해제 시에만 비활성화)
ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS tts_call_enabled boolean NOT NULL DEFAULT true;

-- 2. 더 이상 쓰지 않는 예전 중복방지 컬럼 제거 (아래 3번 테이블로 대체)
ALTER TABLE public.incidents DROP COLUMN IF EXISTS call_escalated_at;

-- 3. (incident_id, mode) 단위 에스컬레이션 중복 실행 방지 테이블
--    앱(anon key)이 직접 건드릴 일이 없으므로 RLS만 켜두고 정책은 추가하지 않음
--    (service_role을 쓰는 Edge Function만 접근 가능 — RLS는 자동 우회됨)
CREATE TABLE IF NOT EXISTS public.incident_call_escalations (
  incident_id  text NOT NULL,
  mode         text NOT NULL,
  escalated_at bigint NOT NULL,
  PRIMARY KEY (incident_id, mode)
);
ALTER TABLE public.incident_call_escalations ENABLE ROW LEVEL SECURITY;

-- 4. 트리거를 AFTER INSERT OR UPDATE로 교체 (감지기동작→전체화재 승격 UPDATE도 감지)
--    [PROJECT_REF] 와 [ANON_KEY] 를 실제 값으로 교체 후 실행하세요.
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
DROP TRIGGER IF EXISTS on_incident_call_escalation ON public.incidents;
CREATE TRIGGER on_incident_call_escalation
  AFTER INSERT OR UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION notify_incident_call_escalation();

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'tts_call_enabled';
-- SELECT * FROM pg_policies WHERE tablename = 'incident_call_escalations'; -- 정책 없음이 정상
