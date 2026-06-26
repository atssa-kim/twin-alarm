import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Kakao 알림톡 (SOLAPI) ───────────────────────────────────────────────────
// 필요 Supabase Secrets:
//   SOLAPI_API_KEY      - SOLAPI 계정 API Key
//   SOLAPI_API_SECRET   - SOLAPI 계정 API Secret
//   KAKAO_PF_ID         - 카카오 채널(발신프로필) ID  ex) KA01PF...
//   KAKAO_TEMPLATE_ID   - 승인된 알림톡 템플릿 ID    ex) KA01TP...
//   SENDER_PHONE        - 발신 번호 (등록된 번호)     ex) 0212345678
// 템플릿 변수 예시: #{재난} #{장소} #{내용}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendKakaoAlimtalk(
  phones: string[],
  disaster: string,
  location: string,
  content: string,
): Promise<void> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY');
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET');
  const pfId = Deno.env.get('KAKAO_PF_ID');
  const templateId = Deno.env.get('KAKAO_TEMPLATE_ID');
  const senderPhone = Deno.env.get('SENDER_PHONE');

  if (!apiKey || !apiSecret || !pfId || !templateId || !senderPhone) return; // 미설정 시 스킵

  const validPhones = phones
    .map(p => p.replace(/[-\s]/g, ''))
    .filter(p => /^0\d{9,10}$/.test(p));
  if (validPhones.length === 0) return;

  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const signature = await hmacSha256(`${date}${salt}`, apiSecret);

  const messages = validPhones.map(to => ({
    to,
    from: senderPhone.replace(/[-\s]/g, ''),
    type: 'ATA',
    kakaoOptions: {
      pfId,
      templateId,
      variables: {
        '#{재난}': disaster,
        '#{장소}': location,
        '#{내용}': content.slice(0, 90), // 알림톡 변수 90자 제한
      },
    },
  }));

  try {
    const resp = await fetch('https://api.solapi.com/messages/v4/send-many', {
      method: 'POST',
      headers: {
        'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    });
    const result = await resp.json();
    console.log(`[Kakao] sent=${result?.groupInfo?.count?.total ?? validPhones.length}, status=${resp.status}`);
  } catch (e) {
    console.warn('[Kakao] 발송 실패:', e);
  }
}
// ────────────────────────────────────────────────────────────────────────────

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
  // notification 필드를 제거하고 data-only 메시지로 전송
  // → onBackgroundMessage 가 항상 실행됨 (notification 필드가 있으면 브라우저가 직접 처리하여 SW 콜백 미실행)
  const resp = await fetch(FCM_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        data: { ...data, title, body },   // title/body 도 data 에 포함 (SW 에서 읽음)
        webpush: {
          headers: { Urgency: 'high' },    // 배터리 절약 모드에서도 즉시 전달
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

    // ── Kakao 알림톡 발송 (SOLAPI Secrets 설정 시 자동 실행) ──────────────
    const empNoList: string[] = drillEmpNos
      ? String(drillEmpNos).split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    let phoneQuery = supabase.from('employees').select('phone').not('phone', 'is', null);
    if (empNoList.length > 0) phoneQuery = (phoneQuery as any).in('emp_no', empNoList);
    const { data: empPhones } = await phoneQuery;
    const phones = (empPhones ?? []).map((e: { phone: string }) => e.phone).filter(Boolean);
    await sendKakaoAlimtalk(phones, disaster, location, bodyText);
    // ────────────────────────────────────────────────────────────────────────

    return new Response(JSON.stringify({ sent: subs.length, kakao: phones.length }), {
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
