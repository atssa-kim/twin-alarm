import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT_ID = 'disaster-response-system-f669b';
const FCM_URL = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
const APP_URL = 'https://atssa-kim.github.io/twin-alarm/';
const APP_ICON = 'https://atssa-kim.github.io/twin-alarm/favicon.png';

// PEM private key → ArrayBuffer
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

// base64url encode
function b64url(input: string | Uint8Array): string {
  const binary = typeof input === 'string'
    ? input
    : Array.from(input, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Google OAuth2 access token via service account JWT
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

// FCM v1 단일 토큰 발송
async function sendFcmPush(
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<void> {
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
          fcm_options: { link: APP_URL },
        },
      },
    }),
  });

  if (!resp.ok) {
    console.warn(`FCM send failed [${token.slice(0, 20)}...]: ${await resp.text()}`);
  }
}

Deno.serve(async (req) => {
  try {
    const saJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
    if (!saJson) throw new Error('FIREBASE_SERVICE_ACCOUNT secret not set');
    const sa = JSON.parse(saJson);

    const body = await req.json();
    const { type, record, old_record } = body;

    // INSERT = 신규 발령 / UPDATE = 승격(mode 변경시만)
    if (type !== 'INSERT' && type !== 'UPDATE') {
      return new Response('ignored', { status: 200 });
    }
    if (type === 'UPDATE' && record?.mode === old_record?.mode) {
      return new Response('mode unchanged', { status: 200 });
    }
    if (record?.status !== 'active') {
      return new Response('not active', { status: 200 });
    }

    const isTraining = String(record.mode).startsWith('훈련');
    const isEscalation = type === 'UPDATE';
    const title = isEscalation
      ? `${isTraining ? '🏋️' : '🔥'} ${record.disaster} 승격 발령`
      : `${isTraining ? '🎓' : '🚨'} ${record.disaster} 비상 발령`;
    const bodyText = isEscalation
      ? `[${record.mode}] ${record.location} — 나머지 대원 소집`
      : `[${record.mode}] 위치: ${record.location} — 임무를 확인하세요.`;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('fcm_token');
    if (error) throw new Error('DB error: ' + error.message);
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
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
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('notify-incident error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
