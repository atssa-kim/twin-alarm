import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── SOLAPI 보이스(TTS 전화) 에스컬레이션 ────────────────────────────────────
// "실제 상황" 발령 후 30초가 지나도 앱을 열어보지 않은 지휘연락급(총괄/통제/상황
// 배지) 대상자에게만 전화를 겁니다. 훈련(mode가 '훈련'으로 시작)은 제외.
// 30초는 골든타임(3분) 안에서 최대한 빨리 잡기 위한 값 — 짧을수록 정상적으로
// 반응 중인 사람에게도 전화가 걸릴 가능성이 커지는 트레이드오프가 있음(2026-07-16 논의).
//
// 필요 Supabase Secrets (notify-incident와 동일한 SOLAPI 계정 재사용):
//   SOLAPI_API_KEY, SOLAPI_API_SECRET, SENDER_PHONE
//
// 트리거: incidents AFTER INSERT (scripts/migrations/add-call-escalation-260716.sql)
// pg_net.http_post는 즉시 반환되므로 발령 자체는 지연되지 않음 — 이 함수 안에서
// 30초 대기(sleep) 후 확인 여부를 재조회합니다.

const CALL_DELAY_MS = 30_000;
const COMMAND_BADGES = ['총괄', '통제', '상황'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendVoiceCalls(phones: string[], text: string): Promise<void> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY');
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET');
  const senderPhone = Deno.env.get('SENDER_PHONE');
  if (!apiKey || !apiSecret || !senderPhone) {
    console.warn('[Voice] SOLAPI secrets 미설정 — 스킵');
    return;
  }

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
    type: 'CTI', // SOLAPI 음성(TTS 전화) 메시지 타입
    text: text.slice(0, 490), // 한글 최대 490자
    voiceOptions: { voiceType: 'FEMALE' },
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
    console.log(`[Voice] called=${result?.groupInfo?.count?.total ?? validPhones.length}, status=${resp.status}`);
  } catch (e) {
    console.warn('[Voice] 발신 실패:', e);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const body = await req.json();
    const { type, record } = body;

    if (type !== 'INSERT' || record?.status !== 'active') {
      return new Response('ignored', { status: 200, headers: CORS });
    }
    const mode: string = record.mode || '';
    if (mode.startsWith('훈련')) {
      return new Response('training — skipped', { status: 200, headers: CORS });
    }

    const incidentId: string = record.id;
    const disaster: string = record.disaster || '';
    const location: string = record.location || '';
    const shift: string = record.shift || 'day';

    // 발령 즉시 응답은 보내되, 함수 실행은 30초 대기 후 계속 진행
    await sleep(CALL_DELAY_MS);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 그 사이 상황 종료됐거나 이미 에스컬레이션 처리됐으면 중단
    const { data: current, error: curErr } = await supabase
      .from('incidents')
      .select('status, call_escalated_at')
      .eq('id', incidentId)
      .maybeSingle();
    if (curErr) throw new Error('incidents 조회 오류: ' + curErr.message);
    if (!current || current.status !== 'active' || current.call_escalated_at) {
      return new Response('skip: closed or already escalated', { status: 200, headers: CORS });
    }

    // 먼저 플래그 선점 (동시 중복 실행 방지)
    const { error: claimErr } = await supabase
      .from('incidents')
      .update({ call_escalated_at: Date.now() })
      .eq('id', incidentId)
      .is('call_escalated_at', null);
    if (claimErr) throw new Error('call_escalated_at 갱신 오류: ' + claimErr.message);

    // 지휘연락급(총괄/통제/상황) 대상자 조회
    const { data: badgeRows, error: badgeErr } = await supabase
      .from('employee_disaster_badges')
      .select('emp_no')
      .eq('disaster', disaster)
      .eq('shift', shift)
      .in('badge', COMMAND_BADGES);
    if (badgeErr) throw new Error('employee_disaster_badges 조회 오류: ' + badgeErr.message);
    const targetEmpNos = [...new Set((badgeRows ?? []).map((r: { emp_no: string }) => r.emp_no))];
    if (targetEmpNos.length === 0) {
      return new Response(JSON.stringify({ called: 0, reason: 'no command-tier targets' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // 이미 앱을 열어 확인(ack)한 사람 제외
    const { data: ackRows, error: ackErr } = await supabase
      .from('incident_acks')
      .select('emp_no')
      .eq('incident_id', incidentId);
    if (ackErr) throw new Error('incident_acks 조회 오류: ' + ackErr.message);
    const ackedSet = new Set((ackRows ?? []).map((r: { emp_no: string }) => r.emp_no));
    const unackedEmpNos = targetEmpNos.filter(empNo => !ackedSet.has(empNo));
    if (unackedEmpNos.length === 0) {
      return new Response(JSON.stringify({ called: 0, reason: 'all acked' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { data: empRows, error: empErr } = await supabase
      .from('employees')
      .select('phone')
      .in('emp_no', unackedEmpNos)
      .not('phone', 'is', null);
    if (empErr) throw new Error('employees 조회 오류: ' + empErr.message);
    const phones = (empRows ?? []).map((e: { phone: string }) => e.phone).filter(Boolean);

    const ttsText = `${disaster} 발생. ${location}. 즉시 대응 바랍니다.`;
    await sendVoiceCalls(phones, ttsText);

    return new Response(JSON.stringify({ called: phones.length, targets: unackedEmpNos.length }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('escalate-unacked-calls error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
