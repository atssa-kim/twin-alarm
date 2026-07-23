-- ══════════════════════════════════════════════════════════════
-- TTS 필수인원을 하드코딩 배열 대신 AdminPanel 체크박스로 관리하도록 변경 (2026-07-24)
-- 기존 FIRE_MUST_CALL_EMP_NOS(화재 전용, 8명 고정)를 폐지하고, 재난별로 "TTS 필수" 체크된
-- 사람에게 실제상황 발령 즉시(대기 없이) 전화가 가도록 함. AdminPanel "재난 편제표" 탭에서
-- 배지 배정하듯 사람마다 체크.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.employee_disaster_badges
  ADD COLUMN IF NOT EXISTS tts_must_call boolean NOT NULL DEFAULT false;

-- 기존 화재 필수연락망 8명을 화재/주간에 그대로 이관(운영 연속성 유지 — 필요시 AdminPanel에서 조정)
UPDATE public.employee_disaster_badges
SET tts_must_call = true
WHERE disaster = '화재' AND shift = 'day'
  AND emp_no IN ('E-4001', 'E-0001', 'E-2001', 'E-3001', 'E-5007', 'E-7005', 'E-7004', 'E-9001');

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ══════════════════════════════════════════════════════════════
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'employee_disaster_badges' AND column_name = 'tts_must_call';
-- SELECT emp_no, disaster, shift, badge FROM public.employee_disaster_badges WHERE tts_must_call = true;
