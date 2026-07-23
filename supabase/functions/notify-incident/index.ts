import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── SOLAPI (SMS + Kakao 알림톡) ─────────────────────────────────────────────
// 필요 Supabase Secrets:
//   SOLAPI_API_KEY      - SOLAPI 계정 API Key
//   SOLAPI_API_SECRET   - SOLAPI 계정 API Secret
//   SENDER_PHONE        - 발신 번호 (등록된 번호)     ex) 0212345678
//   KAKAO_PF_ID         - 카카오 채널(발신프로필) ID  ex) KA01PF...  (알림톡 승인 후 설정)
//   KAKAO_TEMPLATE_ID   - 승인된 알림톡 템플릿 ID    ex) KA01TP...  (알림톡 승인 후 설정)
// SMS는 SOLAPI_API_KEY + SOLAPI_API_SECRET + SENDER_PHONE 만으로 즉시 발송
// 알림톡은 KAKAO_PF_ID + KAKAO_TEMPLATE_ID 추가 설정 후 자동 활성화
//
// notify-tts-must-call(TTS 전화)와 동일한 HMAC 서명·발신 로직을 씀. 대시보드
// "Via Editor" 붙여넣기 배포는 파일 하나만 올라가고 상대경로 import를 못 가져오므로
// 공유 모듈(_shared/solapi.ts)로 빼지 않고 각 함수 파일에 그대로 복사해서 유지함(2026-07-20).

interface SolapiMessage {
  to: string;
  from: string;
  type: 'LMS' | 'ATA' | 'CTI';
  [key: string]: unknown;
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 발신 가능한 국내 번호 형식만 남김(하이픈/공백 제거 후 0으로 시작하는 10~11자리)
function normalizePhones(phones: string[]): string[] {
  return phones
    .map(p => p.replace(/[-\s]/g, ''))
    .filter(p => /^0\d{9,10}$/.test(p));
}

// 이미 검증된 메시지 배열을 SOLAPI send-many로 발송. apiKey/apiSecret 미설정 시 조용히 스킵.
async function sendSolapiMessages(
  messages: SolapiMessage[],
  creds: { apiKey?: string; apiSecret?: string },
  logLabel: string,
): Promise<void> {
  const { apiKey, apiSecret } = creds;
  if (!apiKey || !apiSecret) {
    console.warn(`[${logLabel}] SOLAPI secrets 미설정 — 스킵`);
    return;
  }
  if (messages.length === 0) return;

  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const signature = await hmacSha256(`${date}${salt}`, apiSecret);

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
    console.log(`[${logLabel}] sent=${result?.groupInfo?.count?.total ?? messages.length}, status=${resp.status}`);
  } catch (e) {
    console.warn(`[${logLabel}] 발송 실패:`, e);
  }
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
  if (!pfId || !templateId || !senderPhone) return; // 알림톡 설정 미완료 시 스킵

  const validPhones = normalizePhones(phones);
  const messages: SolapiMessage[] = validPhones.map(to => ({
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
  await sendSolapiMessages(messages, { apiKey, apiSecret }, 'Kakao');
}

// ─── SMS 발송 (SOLAPI LMS) ────────────────────────────────────────────────────
// 알림톡 심사 전/후 관계없이 항상 발송. KAKAO_TEMPLATE_ID 미설정 시 SMS만 발송됨.
async function sendSMS(
  phones: string[],
  disaster: string,
  location: string,
  content: string,
): Promise<void> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY');
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET');
  const senderPhone = Deno.env.get('SENDER_PHONE');
  if (!senderPhone) return;

  const validPhones = normalizePhones(phones);
  const text = `[트윈타워 재난알람]\n${disaster} 발생\n위치: ${location}\n\n${content}\n\n앱에서 행동매뉴얼을 확인하세요.`;
  const messages: SolapiMessage[] = validPhones.map(to => ({
    to,
    from: senderPhone.replace(/[-\s]/g, ''),
    type: 'LMS',
    subject: `[재난알람] ${disaster} 발생`,
    text,
  }));
  await sendSolapiMessages(messages, { apiKey, apiSecret }, 'SMS');
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

    // (incident_id, mode) 단위로 중복 발송 방지 — CommanderDashboard가 발령/승격 직후
    // db.sendIncidentPush()로 이 함수를 직접 호출하는 것과, incidents 테이블의
    // on_incident_fcm DB 트리거가 동시에 이 함수를 호출하는 것 두 경로가 항상 겹쳐서
    // 실행됨. 선점 안 되면(이미 처리됨) 조용히 종료해 push/SMS/알림톡이 매번 두 번씩
    // 나가던 문제(2026-07-20 발견)를 막음.
    const supabaseForClaim = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { error: dispatchClaimErr } = await supabaseForClaim
      .from('notify_dispatches')
      .insert({ incident_id: record.id, mode, dispatched_at: Date.now() });
    if (dispatchClaimErr) {
      return new Response('skip: already dispatched for this mode', { status: 200, headers: CORS });
    }

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
    const empNoList: string[] = drillEmpNos
      ? String(drillEmpNos).split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];

    const supabase = supabaseForClaim;
    let subsQuery = supabase.from('push_subscriptions').select('fcm_token');
    if (empNoList.length > 0) subsQuery = (subsQuery as any).in('emp_no', empNoList);
    let phoneQuery = supabase.from('employees').select('phone').not('phone', 'is', null);
    if (empNoList.length > 0) phoneQuery = (phoneQuery as any).in('emp_no', empNoList);

    // push 발송 대상 조회, SMS/알림톡 발송 대상 조회, FCM용 구글 OAuth 토큰 발급은
    // 서로 의존 관계가 없으므로 병렬로 실행 (2026-07-20 — 이전엔 순차 실행이라 불필요하게 느렸음)
    const [{ data: subs, error: subsErr }, { data: empPhones, error: phoneErr }, accessToken] = await Promise.all([
      subsQuery,
      phoneQuery,
      getGoogleAccessToken(sa),
    ]);
    if (subsErr) throw new Error('push_subscriptions 조회 오류: ' + subsErr.message);
    if (phoneErr) throw new Error('employees 조회 오류: ' + phoneErr.message);

    if (subs && subs.length > 0) {
      await Promise.allSettled(
        subs.map((s: { fcm_token: string }) =>
          sendFcmPush(accessToken, s.fcm_token, title, bodyText, {
            disaster: record.disaster ?? '',
            location: record.location ?? '',
            mode: record.mode ?? '',
          })
        )
      );
    }

    // ── SMS + Kakao 알림톡 병행 발송 ─────────────────────────────────────────
    // push 대상이 0명이어도(아직 알림 권한 허용 안 한 경우 등) SMS/알림톡은 별도로 계속 발송됨
    const phones = (empPhones ?? []).map((e: { phone: string }) => e.phone).filter(Boolean);
    await Promise.all([
      sendSMS(phones, disaster, location, bodyText),        // SOLAPI_API_KEY + SENDER_PHONE 설정 시 즉시 발송 (알림톡 심사와 무관)
      sendKakaoAlimtalk(phones, disaster, location, bodyText), // KAKAO_PF_ID + KAKAO_TEMPLATE_ID 설정 시 추가 발송 (심사 완료 후)
    ]);
    // ─────────────────────────────────────────────────────────────────────────

    return new Response(JSON.stringify({ sent: subs?.length ?? 0, sms: phones.length, kakao: phones.length }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('notify-incident error:', message);
    return new Response(JSON.stringify({ error: 'internal error' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
