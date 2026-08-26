import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── SOLAPI 보이스(TTS 전화) 즉시발신 ────────────────────────────────────
// (2026-07-24 함수명 변경: escalate-unacked-calls → notify-tts-must-call.
// "30초 대기 후 미확인자에게 전화"(에스컬레이션) 방식을 완전히 삭제하고 나니
// 옛 이름이 실제 동작과 안 맞아서 정리함. git 이력의 escalate-unacked-calls
// 디렉터리에서 옛 코드/설계 변천사를 볼 수 있음.)
//
// 규칙은 딱 하나로 통일하되, 대상자 소스는 훈련/실제가 다름(2026-07-24 재정정):
//   실제상황(mode가 '훈련'으로 시작하지 않음) 재난 발령/승격 시
//     → 대기 없이 즉시, TTS 필수인원(employee_disaster_badges.tts_must_call=true,
//       AdminPanel "재난 편제표" 탭에서 재난·사람별로 체크 관리)에게 전화.
//   훈련
//     → 대기 없이 즉시, incidents.tts_emp_nos(지휘본부 "훈련 참여인원설정" 화면에서
//       사람별로 체크한 TTS 즉시발신 대상)에 있는 사람에게만 전화. 2026-07-26부터 이
//       화면에서 참여 체크를 하면 TTS도 기본으로 같이 켜지도록 바뀜(개별로 나중에 끌 수
//       있음) — 더 이상 참여 여부와 완전히 독립적이지 않음, CommanderDashboard.tsx의
//       applyParticipant 참고.
//       AdminPanel의 TTS 필수인원(실제상황용 고정 명단)과는 별개 — 훈련은 매번 다른 사람을
//       테스트하고 싶을 수 있어서 그때그때 참여인원설정 화면에서 고름. 아무도 안 체크했으면
//       (tts_emp_nos 비어있음) 그 훈련은 전화 자체가 안 감 — 별도 on/off 체크박스는 없음.
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
  type?: 'LMS' | 'ATA' | 'VOICE';
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
  // type은 일부러 안 씀 — voiceOptions가 있으면 SOLAPI가 자동으로 음성(VOICE) 타입으로 인식함
  // (공식 SDK 예제와 동일한 방식, 2026-07-24 수정: 기존 'CTI'는 음성 전화와는 다른 별도
  // 타입으로 확인됨 — SOLAPI 공식 solapi-nodejs SDK 소스의 messageTypeSchema에 'CTI'와
  // 'VOICE'가 서로 다른 리터럴로 정의돼 있고, voiceOptions는 'VOICE'와만 짝을 이룸)
  const messages: SolapiMessage[] = validPhones.map(to => ({
    to,
    from: senderPhone.replace(/[-\s]/g, ''),
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
    // 그 외 에러는 진짜 실패이므로 구분해서 로깅. scope 컬럼은 fix-escalation-audit-260724.sql
    // 실행 전엔 없을 수 있어(PGRST204) 그 경우 scope 없이 재시도 — 마이그레이션 전에도 TTS
    // 발신 자체는 막히지 않게 함(스킵 판정 정확도만 살짝 낮아짐).
    let claimErr = (await supabase
      .from('incident_call_escalations')
      .insert({ incident_id: incidentId, mode, scope, escalated_at: Date.now() })).error;
    if (claimErr?.code === 'PGRST204') {
      console.warn(`incident_call_escalations.scope 컬럼 없음 — 없이 재시도. fix-escalation-audit-260724.sql 실행 필요.`);
      claimErr = (await supabase
        .from('incident_call_escalations')
        .insert({ incident_id: incidentId, mode, escalated_at: Date.now() })).error;
    }
    if (claimErr) {
      if (claimErr.code === '23505') {
        return new Response('skip: already processed for this mode', { status: 200, headers: CORS });
      }
      console.error(`클레임 INSERT 실패(예상 밖 오류, incident=${incidentId}, mode=${mode}):`, claimErr.message);
      return new Response('claim insert failed: ' + claimErr.message, { status: 500, headers: CORS });
    }

    // 대상 emp_no 목록 결정 — 훈련은 참여인원설정에서 사람별로 체크한 tts_emp_nos를 그대로 씀
    // (배지 조회 없이), 실제는 AdminPanel "재난 편제표"의 TTS 필수인원(tts_must_call=true) 배지 조회.
    let targetEmpNos: string[];
    if (isTraining) {
      targetEmpNos = typeof record.tts_emp_nos === 'string' && record.tts_emp_nos.length > 0
        ? [...new Set(record.tts_emp_nos.split(',').filter(Boolean))]
        : [];
    } else {
      const { data: mustCallBadgeRows, error: badgeErr } = await supabase
        .from('employee_disaster_badges')
        .select('emp_no')
        .eq('disaster', disaster)
        .eq('shift', 'day')
        .eq('tts_must_call', true);
      if (badgeErr?.code === 'PGRST204') {
        console.error('employee_disaster_badges.tts_must_call 컬럼 없음 — add-tts-must-call-260724.sql 미실행. 대상 0명으로 처리.');
      } else if (badgeErr) {
        throw new Error('employee_disaster_badges 조회 오류: ' + badgeErr.message);
      }
      targetEmpNos = [...new Set((mustCallBadgeRows ?? []).map((r: { emp_no: string }) => r.emp_no))];
    }

    let phones: string[] = [];
    if (targetEmpNos.length > 0) {
      const { data: empRows, error: empErr } = await supabase
        .from('employees')
        .select('phone')
        .in('emp_no', targetEmpNos)
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
      console.error(`TTS 발신 실패(incident=${incidentId}, mode=${mode}):`, result.error);
    }

    await recordResult(supabase, incidentId, mode, {
      target_count: targetEmpNos.length,
      called_count: result.sent,
      error: result.ok ? null : (result.error ?? '발신 실패'),
    });

    return new Response(JSON.stringify({ called: result.sent, targets: targetEmpNos.length, ok: result.ok }), {
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
