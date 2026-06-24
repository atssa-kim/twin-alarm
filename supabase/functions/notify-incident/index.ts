// Supabase Edge Function: notify-incident
// Supabase Database Webhook → incidents INSERT/UPDATE → FCM 전송
//
// 환경변수 (Supabase Dashboard > Edge Functions > Secrets):
//   FCM_SERVER_KEY  : Firebase 콘솔 > 프로젝트 설정 > Cloud Messaging > 서버 키
//   SUPABASE_URL    : 자동 주입
//   SUPABASE_SERVICE_ROLE_KEY : 자동 주입

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FCM_SERVER_KEY = Deno.env.get('FCM_SERVER_KEY') ?? '';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SKEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_URL        = 'https://atssa-kim.github.io/twin-alarm/';

serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record ?? body.new ?? null;

    if (!record || record.status !== 'active') {
      return new Response('skip', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SKEY);
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('fcm_token');

    if (error) throw error;

    const tokens: string[] = (subs ?? [])
      .map((s: any) => s.fcm_token)
      .filter(Boolean);

    if (!tokens.length) {
      console.log('FCM: 등록된 토큰 없음');
      return new Response('no tokens', { status: 200 });
    }

    const modeLabel =
      record.mode === '실제'  ? '🔴 실제 발령' :
      record.mode === '훈련'  ? '🔵 훈련 상황' : '⚠️ 발령';

    const fcmBody = {
      registration_ids: tokens,
      priority: 'high',
      notification: {
        title: `${modeLabel} — ${record.disaster}`,
        body:  `위치: ${record.location} | 앱을 열어 임무를 확인하세요.`,
        icon:  '/twin-alarm/favicon.png',
        sound: 'default',
      },
      data: {
        incidentId: record.id,
        disaster:   record.disaster,
        location:   record.location,
        mode:       record.mode,
      },
      webpush: {
        notification: {
          requireInteraction: true,
          renotify: true,
          tag: `twin-alarm-${record.id}`,
          vibrate: [400, 150, 400, 150, 600],
        },
        fcm_options: { link: APP_URL },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${FCM_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fcmBody),
    });

    const result = await res.json();
    console.log(`FCM 전송: ${result.success}/${tokens.length} 성공`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-incident 오류:', err);
    return new Response(String(err), { status: 500 });
  }
});
