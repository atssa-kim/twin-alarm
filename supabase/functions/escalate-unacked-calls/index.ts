import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── SOLAPI 보이스(TTS 전화) 에스컬레이션 ────────────────────────────────────
// 발령/승격 후 30초가 지나도 앱을 열어보지 않은 대상자에게만 전화를 겁니다.
// 발령 시 "TTS 전화 사용"을 해제한 경우는 완전히 제외.
// 30초는 골든타임(3분) 안에서 최대한 빨리 잡기 위한 값 — 짧을수록 정상적으로
// 반응 중인 사람에게도 전화가 걸릴 가능성이 커지는 트레이드오프가 있음(2026-07-16 논의).
//
// 야간(shift='night')은 TTS를 아예 쓰지 않습니다(2026-07-24) — 야간 근무자는 항상
// 무전기를 휴대하고 있어 TTS 전화 자체가 불필요하다는 판단. 필수인원 즉시발신·30초
// 미확인자 발신 전부 스킵하고 함수가 바로 종료됩니다.
//
// 대상자 범위 (주간, 2026-07-24 정리):
//   훈련(mode가 '훈련'으로 시작)                 → 통제(각 조 통제자)만, 30초 대기 후 미확인자에게만.
//     필수인원 즉시발신은 훈련엔 적용 안 됨(실제상황 전용) — 훈련마다 필수인원한테까지 전화가
//     가면 번거로우므로.
//   화재 감지기동작(scope='fire_initial')        → 총괄/통제/출동
//   화재 전체화재, 감지기동작 단계를 이미 거친 경우 → 총괄/통제/출동을 "제외한" 나머지 전 배지
//   화재 전체화재를 감지기동작 없이 곧바로 발령한 경우 → 전 배지(제외 없음) — 총괄/통제/출동이
//     한 번도 에스컬레이션 대상이 된 적 없으므로 여기서 빠지면 아무도 안 걸림(2026-07-20 발견된 버그)
//   그 외 8개 재난                                → 총괄/통제/상황 (지휘연락급)
//
// TTS 필수인원(2026-07-24 — 하드코딩 배열 폐지, AdminPanel 체크박스로 관리):
//   실제상황(훈련 아님) 발령/승격 시, 배지·확인여부·30초 대기와 완전히 별개로
//   employee_disaster_badges.tts_must_call=true인 사람에게 대기 없이 즉시 전화가 갑니다.
//   재난 편제표(AdminPanel) 탭에서 배지 배정된 사람마다 "TTS 필수" 체크박스로 재난별 관리.
//   배지 대상자와 겹치면 30초 뒤 다시 걸릴 수 있음(중복 허용). 예전엔 화재 전용 8명
//   하드코딩 배열(FIRE_MUST_CALL_EMP_NOS)이었는데, 재난 무관하게 일반화하고 담당자가
//   코드 수정 없이 체크박스로 바꿀 수 있게 변경.
//
// 감지기동작→전체화재 승격은 새 발령(INSERT)이 아니라 같은 incident 행의
// UPDATE라서, 같은 incident_id가 두 번(1.1, 1.2) 에스컬레이션될 수 있음 →
// incident_call_escalations(incident_id, mode)로 (재난,상황단계) 단위 중복 방지.
// 이 행에 scope/결과(대상수·발신수·에러)를 같이 남겨서(2026-07-24 추가) 실패해도
// 완전히 조용히 사라지지 않고 나중에 조회로 확인할 수 있게 함.
//
// 필요 Supabase Secrets (notify-incident와 동일한 SOLAPI 계정 재사용):
//   SOLAPI_API_KEY, SOLAPI_API_SECRET, SENDER_PHONE
//
// 트리거: incidents AFTER INSERT OR UPDATE (scripts/migrations/update-call-escalation-260716b.sql)
// pg_net.http_post는 즉시 반환되므로 발령/승격 자체는 지연되지 않음 — 이 함수
// 안에서 30초 대기(sleep) 후 확인 여부를 재조회합니다.

const CALL_DELAY_MS = 30_000;
const COMMAND_BADGES = ['총괄', '통제', '상황'];
const FIRE_INITIAL_BADGES = ['총괄', '통제', '출동'];

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
// 2026-07-24: 성공/실패를 호출부에서 알 수 있도록 결과를 반환(예전엔 로그만 남기고 끝).
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      // 야간은 무전기 상시 휴대로 TTS 자체를 사용하지 않음(2026-07-24)
      return new Response('night shift — TTS not used', { status: 200, headers: CORS });
    }

    mode = record.mode || '';
    const isTraining = mode.startsWith('훈련');
    if (record.tts_call_enabled === false) {
      return new Response('tts call disabled at declare time', { status: 200, headers: CORS });
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

    // (incident_id, mode) 단위로 먼저 선점 — 유니크 제약 위반(23505)이면 이미 처리 중/완료된 것.
    // 그 외 에러 코드는 진짜 실패이므로 구분해서 로그로 남김(2026-07-24 — 예전엔 전부 "이미
    // 처리됨"으로 뭉뚱그려서, 클레임 자체가 실패해도 아무 전화도 안 나가고 조용히 끝났음).
    const { error: claimErr } = await supabase
      .from('incident_call_escalations')
      .insert({ incident_id: incidentId, mode, scope, escalated_at: Date.now() });
    if (claimErr) {
      if (claimErr.code === '23505') {
        return new Response('skip: already escalated for this mode', { status: 200, headers: CORS });
      }
      console.error(`클레임 INSERT 실패(예상 밖 오류, incident=${incidentId}, mode=${mode}):`, claimErr.message);
      return new Response('claim insert failed: ' + claimErr.message, { status: 500, headers: CORS });
    }

    // TTS 필수인원 — 배지/확인여부 판단(30초 대기) 이전에 즉시 발신. 실제상황(훈련 아님)에만
    // 적용 — 훈련마다 필수인원까지 전화가 가면 번거로움(2026-07-24, AdminPanel 체크박스 관리로 전환).
    let mustCallCount = 0;
    if (!isTraining) {
      const { data: mustCallBadgeRows } = await supabase
        .from('employee_disaster_badges')
        .select('emp_no')
        .eq('disaster', disaster)
        .eq('shift', 'day')
        .eq('tts_must_call', true);
      const mustCallEmpNos = [...new Set((mustCallBadgeRows ?? []).map((r: { emp_no: string }) => r.emp_no))];
      const { data: mustCallEmpRows } = mustCallEmpNos.length > 0
        ? await supabase.from('employees').select('phone').in('emp_no', mustCallEmpNos).not('phone', 'is', null)
        : { data: [] as { phone: string }[] };
      const mustCallPhones = (mustCallEmpRows ?? []).map((e: { phone: string }) => e.phone).filter(Boolean);
      if (mustCallPhones.length > 0) {
        const immediateText = `${disaster} 발생. ${location}. 즉시 확인 바랍니다.`;
        const mustCallResult = await sendVoiceCalls(mustCallPhones, immediateText);
        mustCallCount = mustCallResult.sent;
        if (!mustCallResult.ok) {
          console.error(`필수인원 발신 실패(incident=${incidentId}):`, mustCallResult.error);
        }
      }
    }

    // 발령 즉시 응답은 보내되, 함수 실행은 30초 대기 후 계속 진행
    await sleep(CALL_DELAY_MS);

    // 그 사이 상황이 종료됐으면 중단
    const { data: current, error: curErr } = await supabase
      .from('incidents')
      .select('status')
      .eq('id', incidentId)
      .maybeSingle();
    if (curErr) throw new Error('incidents 조회 오류: ' + curErr.message);
    if (!current || current.status !== 'active') {
      await recordResult(supabase, incidentId, mode, { must_call_count: mustCallCount, target_count: 0, called_count: 0 });
      return new Response('skip: incident closed', { status: 200, headers: CORS });
    }

    // 화재 전체화재 단계라면, 감지기동작 단계가 "이 사건에서 실제로 먼저 처리됐는지" 확인.
    // scope='fire_initial' 값으로 판정(mode 문자열 매칭 대신 — 2026-07-24).
    let fireInitialAlreadyHandled = false;
    if (!isTraining && disaster === '화재' && !isFireInitial) {
      const { data: priorInitial } = await supabase
        .from('incident_call_escalations')
        .select('scope')
        .eq('incident_id', incidentId)
        .eq('scope', 'fire_initial')
        .maybeSingle();
      fireInitialAlreadyHandled = !!priorInitial;
    }

    // 대상 배지 범위 결정 (야간은 함수 상단에서 이미 걸러짐 — shift는 항상 'day')
    let badgeQuery = supabase
      .from('employee_disaster_badges')
      .select('emp_no')
      .eq('disaster', disaster)
      .eq('shift', shift);
    if (isTraining) {
      // 훈련은 전화까지 걸리면 번거로우니 각 조 통제자에게만 확인 전화
      badgeQuery = badgeQuery.in('badge', ['통제']);
    } else if (isFireInitial) {
      badgeQuery = badgeQuery.in('badge', FIRE_INITIAL_BADGES);
    } else if (disaster === '화재' && fireInitialAlreadyHandled) {
      // 감지기동작 단계에서 이미 다룬 3배지를 제외한 나머지 전원
      badgeQuery = badgeQuery.not('badge', 'in', `(${FIRE_INITIAL_BADGES.join(',')})`);
    } else if (disaster === '화재') {
      // 감지기동작 없이 곧바로 전체화재로 발령된 경우 — 총괄/통제/출동도 아직 아무 데도
      // 안 걸렸으므로 제외하지 않고 전 배지를 대상으로 함
    } else {
      badgeQuery = badgeQuery.in('badge', COMMAND_BADGES);
    }
    // 대상 배지 조회와, 이미 이 mode(상황 단계)에서 앱을 열어 확인(ack)한 사람 조회는 서로
    // 독립적이므로 병렬 실행. ack는 mode까지 일치시켜서 — 감지기동작 단계에서 확인한 기록이
    // 전체화재 승격 이후까지 "확인됨"으로 잘못 인정되지 않도록 함.
    const [{ data: badgeRows, error: badgeErr }, { data: ackRows, error: ackErr }] = await Promise.all([
      badgeQuery,
      supabase.from('incident_acks').select('emp_no').eq('incident_id', incidentId).eq('mode', mode),
    ]);
    if (badgeErr) throw new Error('employee_disaster_badges 조회 오류: ' + badgeErr.message);
    if (ackErr) throw new Error('incident_acks 조회 오류: ' + ackErr.message);
    const targetEmpNos = [...new Set((badgeRows ?? []).map((r: { emp_no: string }) => r.emp_no))];

    if (targetEmpNos.length === 0) {
      await recordResult(supabase, incidentId, mode, { must_call_count: mustCallCount, target_count: 0, called_count: 0 });
      return new Response(JSON.stringify({ called: 0, reason: 'no targets' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const ackedSet = new Set((ackRows ?? []).map((r: { emp_no: string }) => r.emp_no));
    const unackedEmpNos = targetEmpNos.filter(empNo => !ackedSet.has(empNo));
    if (unackedEmpNos.length === 0) {
      await recordResult(supabase, incidentId, mode, { must_call_count: mustCallCount, target_count: targetEmpNos.length, called_count: 0 });
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

    const ttsText = isTraining
      ? `훈련상황입니다. ${disaster} 훈련. ${location}. 통제관 확인 바랍니다.`
      : isFireInitial
        ? `화재감지기 동작. ${location}. 확인 바랍니다.`
        : `${disaster} 발생. ${location}. 즉시 대응 바랍니다.`;
    const callResult = await sendVoiceCalls(phones, ttsText);

    await recordResult(supabase, incidentId, mode, {
      must_call_count: mustCallCount,
      target_count: targetEmpNos.length,
      called_count: callResult.sent,
      error: callResult.ok ? null : (callResult.error ?? '발신 실패'),
    });

    return new Response(JSON.stringify({ called: callResult.sent, targets: unackedEmpNos.length, ok: callResult.ok }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('escalate-unacked-calls error:', message);
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
  fields: { must_call_count?: number; target_count?: number; called_count?: number; error?: string | null },
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
