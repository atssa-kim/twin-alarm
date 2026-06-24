-- FCM 푸시 구독 토큰 테이블
-- Supabase SQL Editor에서 실행

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  emp_no     text NOT NULL,
  fcm_token  text NOT NULL UNIQUE,
  updated_at bigint DEFAULT EXTRACT(EPOCH FROM now())::bigint
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_emp_no ON push_subscriptions(emp_no);

-- Row Level Security (선택 — 운영 시 적용 권장)
-- ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
