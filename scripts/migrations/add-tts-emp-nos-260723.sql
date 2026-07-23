-- ══════════════════════════════════════════════════════════════
-- 훈련 참여인원설정에 사람별 "TTS 전화 받기" 체크박스 추가 (2026-07-23)
-- 지금까지 훈련 중 TTS 무응답자 전화는 배지(통제)로만 걸렸고, 참여인원 선택
-- (drill_emp_nos)과 무관했음. 이제 훈련 참여인원설정 화면에서 사람마다 별도로
-- "TTS 전화 받기"를 지정할 수 있게 하고, 지정돼 있으면 그 목록만 대상으로 함
-- (escalate-unacked-calls Edge Function이 record.tts_emp_nos를 읽음).
--
-- 트리거(notify_incident_call_escalation)는 row_to_json(NEW)로 전체 행을 그대로
-- 넘기므로, 컬럼만 추가하면 되고 트리거 함수는 손댈 필요 없음.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.incidents ADD COLUMN IF NOT EXISTS tts_emp_nos text;
COMMENT ON COLUMN public.incidents.tts_emp_nos IS
  '훈련 참여인원설정에서 사람별로 지정한 TTS 전화 수신자 emp_no (콤마 구분). NULL/빈값이면 기존처럼 배지(통제) 기준으로 대상 결정.';

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents' AND column_name = 'tts_emp_nos';
