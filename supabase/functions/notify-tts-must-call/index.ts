import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── SOLAPI 보이스(TTS 전화) 즉시발신 ────────────────────────────────────
// (2026-07-24 함수명 변경: escalate-unacked-calls → notify-tts-must-call.
// "30초 대기 후 미확인자에게 전화"(에스컬레이션) 방식을 완전히 삭제하고 나니
// 옛 이름이 실제 동작과 안 맞아서 정리함. git 이력의 escalate-unacked-calls
// 디렉터리에서 옛 코드/설계 변천사를 볼 수 있음.)
//
// 규칙은 딱 하나:
//   실제상황(mode가 '훈련'으로 시작하지 않음) 재난 발령/승격 시
//     → 대기 없이 즉시, TTS 필수인원(employee_disaster_badges.tts_must_call=true,
//       AdminPanel "재난 편제표" 탭에서 재난·사람별로 체크 관리)에게 전화. "TTS 전화 사용"
//       체크박스 상태와 무관하게 항상 발신 — 실제 상황은 끌 수 없음.
//   훈련
//     → "TTS 전화 사용" 체크박스가 켜져 있을 때만, 위와 동일하게(TTS 필수인원에게) 즉시 발신.
//       꺼져 있으면 훈련은 전화 자체를 안 함.
//
// 야간(shift='night')은 여전히 TTS를 쓰지 않음 — 야간 근무자는 항상 무전기를 휴대하고
// 있어 TTS 전화가 불필요하다는 판단(2026-07-24, 유지).
//
// 감지기동작→전체화재 승격은 새 발령(INSERT)이 아니라 같은 incident 행의 UPDATE라서,
// 같은 incident_id가 mode별로 여러 번 처리됨(의도된 동작 — 승격될 때마다 필수인원에게
// 다시 알림) → incident_call_escalations(incident_id, mode)로 (재난,상황단계) 단위
// 중복 실행만 방지(테이블명은 옛 설계 흔적이라 안 맞지만, 데이터 마이그레이션 부담 때문에
// 테이블 자체는 리네임 안 함). 결과(대상수·발신수·에러)도 같이 기록해서 실패해도 나중에 조회 가능.
//
// 필요 Supabase Secrets (notify-incident와 동일한 SOLAPI 계정 재사용):
//   SOLAPI_API_KEY, SOLAPI_API_SECRET, SENDER_PHONE
//
// 트리거: incidents AFTER INSERT OR UPDATE (scripts/migrations/rename-tts-function-260724.sql —
// notify_incident_call_escalation() 트리거 함수의 URL을 이 함수로 재지정)
// pg_net.http_post는 즉시 반환되므로 발령/승격 자체는 지연되지 않음.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// notify-incident와 동일한 HMAC 서명·발신 로직. 대시보드 "Via Editor" 붙여넣기 배포는
// 파일 하나만 올라가고 상대경로 import를 못 가져오므로 공유 모듈로 빼지 않고 각 함수
// 파일에 그대로 복사해서 유지함(2026-07-20).

interface SolapiMessage {
  to: string;
  from: string;
  type: 'LMS' | 'ATA' | 'CTI';
  [key: string]: unknown;
}

type SendResult = { sent: number; ok: boolean; error?: string };

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
): Promise<SendResult> {
  const { apiKey, apiSecret } = creds;
  if (!apiKey || !apiSecret) {
    console.warn(`[${logLabel}] SOLAPI secrets 미설정 — 스킵`);
    return { sent: 0, ok: false, error: 'SOLAPI secrets 미설정' };
  }
  if (messages.length === 0) return { sent: 0, ok: true };

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
    const sent = result?.groupInfo?.count?.total ?? messages.length;
    console.log(`[${logLabel}] sent=${sent}, status=${resp.status}`);
    if (!resp.ok) return { sent, ok: false, error: `SOLAPI HTTP ${resp.status}: ${JSON.stringify(result).slice(0, 300)}` };
    return { sent, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[${logLabel}] 발송 실패:`, e);
    return { sent: 0, ok: false, error: msg };
  }
}

async function sendVoiceCalls(phones: string[], text: string): Promise<SendResult> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY');
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET');
  const senderPhone = Deno.env.get('SENDER_PHONE');
  if (!senderPhone) return { sent: 0, ok: false, error: 'SENDER_PHONE 미설정' };

  const validPhones = normalizePhones(phones);
  const messages: SolapiMessage[] = validPhones.map(to => ({
    to,
    from: senderPhone.replace(/[-\s]/g, ''),
    type: 'CTI', // SOLAPI 음성(TTS 전화) 메시지 타입
    text: text.slice(0, 490), // 한글 최대 490자
    voiceOptions: { voiceType: 'FEMALE' },
  }));
  return await sendSolapiMessages(messages, { apiKey, apiSecret }, 'Voice');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // catch 블록에서도 실패 기록을 남길 수 있도록 try 밖에서 선언
  let supabase: ReturnType<typeof createClient> | null = null;
  let incidentId: string | undefined;
  let mode = '';

  try {
    const body = await req.json();
    const { type, record, old_record } = body;

    if (type !== 'INSERT' && type !== 'UPDATE') {
      return new Response('ignored', { status: 200, headers: CORS });
    }
    if (record?.status !== 'active') {
      return new Response('not active', { status: 200, headers: CORS });
    }
    if (type === 'UPDATE' && record?.mode === old_record?.mode) {
      return new Response('mode unchanged', { status: 200, headers: CORS });
    }

    const shift: string = record.shift || 'day';
    if (shift === 'night') {
      // 야간은 무전기 상시 휴대로 TTS 자체를 사용하지 않음
      return new Response('night shift — TTS not used', { status: 200, headers: CORS });
    }

    mode = record.mode || '';
    const isTraining = mode.startsWith('훈련');

    // 실제상황은 체크박스 상태와 무관하게 항상 발신. 훈련은 체크박스가 켜져 있을 때만.
    if (isTraining && record.tts_call_enabled === false) {
      return new Response('training tts disabled at declare time', { status: 200, headers: CORS });
    }

    incidentId = record.id;
    const disaster: string = record.disaster || '';
    const location: string = record.location || '';
    const scope: string = record.scope || '';
    const isFireInitial = disaster === '화재' && scope === 'fire_initial';

    supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // (incident_id, mode) 단위로 먼저 선점 — 유니크 제약 위반(23505)이면 이미 처리된 것.
    // 그 외 에러는 진짜 실패이므로 구분해서 로깅.
    const { error: claimErr } = await supabase
      .from('incident_call_escalations')
      .insert({ incident_id: incidentId, mode, scope, escalated_at: Date.now() });
    if (claimErr) {
      if (claimErr.code === '23505') {
        return new Response('skip: already processed for this mode', { status: 200, headers: CORS });
      }
      console.error(`클레임 INSERT 실패(예상 밖 오류, incident=${incidentId}, mode=${mode}):`, claimErr.message);
      return new Response('claim insert failed: ' + claimErr.message, { status: 500, headers: CORS });
    }

    // TTS 필수인원 조회 — 재난·주간 기준(AdminPanel "재난 편제표"에서 배지 배정 인원마다 체크)
    const { data: mustCallBadgeRows, error: badgeErr } = await supabase
      .from('employee_disaster_badges')
      .select('emp_no')
      .eq('disaster', disaster)
      .eq('shift', 'day')
      .eq('tts_must_call', true);
    if (badgeErr) throw new Error('employee_disaster_badges 조회 오류: ' + badgeErr.message);
    const mustCallEmpNos = [...new Set((mustCallBadgeRows ?? []).map((r: { emp_no: string }) => r.emp_no))];

    let phones: string[] = [];
    if (mustCallEmpNos.length > 0) {
      const { data: empRows, error: empErr } = await supabase
        .from('employees')
        .select('phone')
        .in('emp_no', mustCallEmpNos)
        .not('phone', 'is', null);
      if (empErr) throw new Error('employees 조회 오류: ' + empErr.message);
      phones = (empRows ?? []).map((e: { phone: string }) => e.phone).filter(Boolean);
    }

    const text = isTraining
      ? `훈련상황입니다. ${disaster} 훈련. ${location}. 확인 바랍니다.`
      : isFireInitial
        ? `화재감지기 동작. ${location}. 확인 바랍니다.`
        : `${disaster} 발생. ${location}. 즉시 확인 바랍니다.`;
    const result = await sendVoiceCalls(phones, text);
    if (!result.ok && phones.length > 0) {
      console.error(`TTS 필수인원 발신 실패(incident=${incidentId}, mode=${mode}):`, result.error);
    }

    await recordResult(supabase, incidentId, mode, {
      target_count: mustCallEmpNos.length,
      called_count: result.sent,
      error: result.ok ? null : (result.error ?? '발신 실패'),
    });

    return new Response(JSON.stringify({ called: result.sent, targets: mustCallEmpNos.length, ok: result.ok }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('notify-tts-must-call error:', message);
    // 실패해도 흔적이 남도록 best-effort로 기록 — 이것마저 실패하면 조용히 무시(원래 에러가 우선)
    if (supabase && incidentId) {
      await recordResult(supabase, incidentId, mode, { error: message });
    }
    return new Response(JSON.stringify({ error: 'internal error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});

// incident_call_escalations 행에 처리 결과를 남김(best-effort — 실패해도 무시하고 원래 흐름을 막지 않음)
async function recordResult(
  supabase: ReturnType<typeof createClient>,
  incidentId: string,
  mode: string,
  fields: { target_count?: number; called_count?: number; error?: string | null },
): Promise<void> {
  try {
    await supabase
      .from('incident_call_escalations')
      .update({ ...fields, completed_at: Date.now() })
      .eq('incident_id', incidentId)
      .eq('mode', mode);
  } catch (e) {
    console.warn('recordResult 실패(무시):', e);
  }
}
