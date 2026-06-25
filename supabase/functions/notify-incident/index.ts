import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT_ID = 'disaster-response-system-f669b';
const FCM_URL = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
const APP_URL = 'https://atssa-kim.github.io/twin-alarm/';
const APP_ICON = 'https://atssa-kim.github.io/twin-alarm/favicon.png';

// 브라우저에서 supabase.functions.invoke 로 직접 호출할 때 필요한 CORS 헤더
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function b64url(input: string | Uint8Array): string {
  const binary = typeof input === 'string'
    ? input
    : Array.from(input, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getGoogleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  );
  const jwt = `${signingInput}.${b64url(sigBytes)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const json = await resp.json();
  if (!json.access_token) throw new Error('Google OAuth2 failed: ' + JSON.stringify(json));
  return json.access_token;
}

async function sendFcmPush(
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<void> {
  // 알림 탭 시 ?alert=1 파라미터로 앱을 열어 TTS 강제 재생
  const alertUrl = APP_URL + '?alert=1';
  const resp = await fetch(FCM_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        webpush: {
          notification: {
            title,
            body,
            icon: APP_ICON,
            badge: APP_ICON,
            requireInteraction: true,
            vibrate: [400, 150, 400, 150, 600],
            tag: 'twin-alarm-incident',
            renotify: true,
          },
          fcm_options: { link: alertUrl },
        },
      },
    }),
  });

  if (!resp.ok) {
    console.warn(`FCM send failed [${token.slice(0, 20)}...]: ${await resp.text()}`);
  }
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const saJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
    if (!saJson) throw new Error('FIREBASE_SERVICE_ACCOUNT secret not set');
    const sa = JSON.parse(saJson);

    const body = await req.json();
    const { type, record, old_record } = body;

    if (type !== 'INSERT' && type !== 'UPDATE') {
      return new Response('ignored', { status: 200, headers: CORS });
    }
    if (type === 'UPDATE' && record?.mode === old_record?.mode) {
      return new Response('mode unchanged', { status: 200, headers: CORS });
    }
    if (record?.status !== 'active') {
      return new Response('not active', { status: 200, headers: CORS });
    }

    const mode: string = record.mode || '';
    const disaster: string = record.disaster || '';
    const location: string = record.location || '';
    const isTraining = mode.startsWith('훈련');
    const isEscalation = type === 'UPDATE';

    // audio.ts triggerEmergencyAlert 와 동일한 본문 계산
    let ttsText: string;
    if (mode === '훈련/감지기') {
      ttsText = `훈련상황! 훈련상황 ${location}에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.`;
    } else if (mode === '훈련/전체') {
      ttsText = `훈련상황! 화재발생! 훈련상황! 화재발생! ${location}으로 신속히 출동하시기 바랍니다.`;
    } else if (mode === '실제/감지기') {
      ttsText = `화재감지기동작!, 화재감지기동작! ${location}에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.`;
    } else if (mode === '실제/화재') {
      ttsText = `화재발생!, 화재발생! ${location}에서 화재발생 신속히 출동하시기 바랍니다.`;
    } else if (isTraining) {
      ttsText = `훈련 ${disaster}발생!, 훈련 ${disaster}발생! ${location}에서 훈련 ${disaster}발생 신속히 출동하시기 바랍니다.`;
    } else {
      ttsText = `${disaster}발생!, ${disaster}발생! ${location}에서 ${disaster}발생 신속히 출동하시기 바랍니다.`;
    }

    const title = isEscalation
      ? `${isTraining ? '🏋️' : '🔥'} ${disaster} 승격 발령`
      : `${isTraining ? '🎓' : '🚨'} ${disaster} 비상 발령`;
    const bodyText = ttsText;

    // drill_emp_nos: 앱 직접 호출(body) 또는 DB 트리거(record 컬럼)
    const drillEmpNos: string | null = body.drill_emp_nos || record?.drill_emp_nos || null;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    let subsQuery = supabase.from('push_subscriptions').select('fcm_token');
    if (drillEmpNos) {
      const empNoList = String(drillEmpNos).split(',').map((s: string) => s.trim()).filter(Boolean);
      if (empNoList.length > 0) subsQuery = (subsQuery as any).in('emp_no', empNoList);
    }
    const { data: subs, error } = await subsQuery;
    if (error) throw new Error('DB error: ' + error.message);
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const accessToken = await getGoogleAccessToken(sa);

    await Promise.allSettled(
      subs.map((s: { fcm_token: string }) =>
        sendFcmPush(accessToken, s.fcm_token, title, bodyText, {
          disaster: record.disaster ?? '',
          location: record.location ?? '',
          mode: record.mode ?? '',
        })
      )
    );

    return new Response(JSON.stringify({ sent: subs.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('notify-incident error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
