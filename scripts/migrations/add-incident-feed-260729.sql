-- ══════════════════════════════════════════════════════════════
-- 현장 피드(무전 로그) 신설 (2026-07-29)
-- 재난 진행 중 대원들이 텍스트·사진·동영상을 시간순으로 남기는 카톡형 타임라인.
-- "나의 임무" 탭에 세그먼트 토글(내 임무 / 현장 피드)로 추가됨.
-- incidents 테이블과 동일 컨벤션: id는 TEXT(클라이언트 생성), 시간은 BIGINT(epoch ms).
-- Supabase SQL Editor에서 이 파일 전체를 1회 실행하세요.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.incident_feed (
    id            TEXT PRIMARY KEY,
    incident_id   TEXT NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
    emp_no        TEXT,                 -- 시스템 메시지(발령 등)는 NULL
    author_name   TEXT NOT NULL,
    author_team   TEXT,
    author_badge  TEXT,
    type          TEXT NOT NULL CHECK (type IN ('text', 'photo', 'video', 'system')),
    content       TEXT,                 -- 텍스트 내용 또는 사진/동영상 캡션
    media_path    TEXT,                 -- Storage(incident-feed 버킷) object path — photo/video일 때만
    created_at    BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS incident_feed_incident_id_idx ON public.incident_feed (incident_id, created_at);

-- 운영 테이블과 동일하게 RLS는 켜되(보안 경고 방지) anon key 전면 허용 —
-- twin-alarm에 별도 로그인 시스템이 없어 앱 자체가 anon key로 CRUD함(fix-rls-disabled-260715.sql과 동일 원칙).
ALTER TABLE public.incident_feed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feed_all" ON public.incident_feed;
CREATE POLICY "feed_all" ON public.incident_feed USING (true) WITH CHECK (true);

-- Realtime 구독 활성화 (재실행해도 안전하도록 이미 등록돼 있으면 건너뜀)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'incident_feed'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_feed;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- Storage: 사진/동영상 첨부용 public 버킷
-- (대시보드 Storage 화면에서 "incident-feed" 버킷을 Public으로 직접 만들어도 동일함)
-- ══════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-feed', 'incident-feed', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "incident_feed_media_read" ON storage.objects;
CREATE POLICY "incident_feed_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'incident-feed');

DROP POLICY IF EXISTS "incident_feed_media_insert" ON storage.objects;
CREATE POLICY "incident_feed_media_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'incident-feed');

-- ══════════════════════════════════════════════════════════════
-- 적용 후 확인 쿼리
-- ══════════════════════════════════════════════════════════════
-- SELECT * FROM public.incident_feed ORDER BY created_at DESC LIMIT 20;
-- SELECT * FROM storage.buckets WHERE id = 'incident-feed';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'incident_feed';
