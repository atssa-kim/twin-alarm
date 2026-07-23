import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── SOLAPI 보이스(TTS 전화) 에스컬레이션 ────────────────────────────────────
// 발령/승격 후 30초가 지나도 앱을 열어보지 않은 대상자에게만 전화를 겁니다.
// 발령 시 "TTS 전화 사용"을 해제한 경우는 완전히 제외.
// 30초는 골든타임(3분) 안에서 최대한 빨리 잡기 위한 값 — 짧을수록 정상적으로
// 반응 중인 사람에게도 전화가 걸릴 가능성이 커지는 트레이드오프가 있음(2026-07-16 논의).
//
// 대상자 범위 (2026-07-16b, 2026-07-20 수정, 2026-07-20c 훈련 범위 추가, 2026-07-24 야간 정리):
//   훈련(mode가 '훈련'으로 시작)                        → 통제(각 조 통제자)만 — 훈련마다 전 대원에게
//     전화까지 걸리면 번거로우니 확인 전화는 조 대표자에게만 감. (2026-07-23: 참여인원설정에서
//     사람별로 TTS 수신자를 따로 고르는 기능을 시도했다가, 실제 상황엔 영향 없는 훈련 전용
//     기능인데도 UI만 복잡해져서 도로 걷어냄 — 필요해지면 이 파일 git 이력의 2026-07-23 커밋 참고)
//   화재 감지기동작(scope='fire_initial') · 주간         → 총괄/통제/출동
//   화재 전체화재, 감지기동작 단계를 이미 거친 경우 · 주간 → 총괄/통제/출동을 "제외한" 나머지 전 배지
//   화재 전체화재를 감지기동작 없이 곧바로 발령한 경우 · 주간 → 전 배지(제외 없음) — 총괄/통제/출동이
//     한 번도 에스컬레이션 대상이 된 적 없으므로 여기서 빠지면 아무도 안 걸림(2026-07-20 발견된 버그)
//   화재 · 야간(모든 단계)                               → 총괄/통제/출동 구분 없이 그 재난·야간에 배정된
//     전 배지(현재는 현장/대피) 대상. 야간엔 그 배지 체계가 아예 없어(주간 전용 파트장 개념) 위
//     주간 로직을 그대로 적용하면 감지기동작 단계가 0명으로 비게 되는 문제가 있었음(2026-07-24 수정).
//     추가로 incidents.night_duty_group(A|B|C|D)이 지정돼 있으면 그 조 소속(employees.shift_group)
//     으로만 좁힘 — 4교대라 비번인 3개조까지 전화가 가던 문제 해결.
//   그 외 8개 재난                                       → 총괄/통제/상황 (지휘연락급)
//
// 화재 필수 연락망(2026-07-23): 위 배지·확인여부·30초 대기와 완전히 별개로,
// 화재 발령/승격 시(훈련 포함) FIRE_MUST_CALL_EMP_NOS 8명에게는 대기 없이 즉시
// 전화가 갑니다. 배지 대상자와 겹치면 30초 뒤 다시 걸릴 수 있음(중복 허용).
// 단, 이 8명은 주간 근무 파트장급이라 야간(shift='night')엔 퇴근한 상태 —
// 야간은 이 즉시발신 대상에서 제외(2026-07-24).
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

// 화재 필수 연락망 — 배지·확인여부·30초 대기와 무관하게 화재 발령/승격 즉시 무조건 전화(주간만)
// (2026-07-23 추가): 김견수·김기창·손남열·이길호·김정훈·김성진·길성용·김재석
const FIRE_MUST_CALL_EMP_NOS = [
  'E-4001', 'E-0001', 'E-2001', 'E-3001', 'E-5007', 'E-7005', 'E-7004', 'E-9001',
];

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
    mode = record.mode || '';
    const isTraining = mode.startsWith('훈련');
    if (record.tts_call_enabled === false) {
      return new Response('tts call disabled at declare time', { status: 200, headers: CORS });
    }

    incidentId = record.id;
    const disaster: string = record.disaster || '';
    const location: string = record.location || '';
    const shift: string = record.shift || 'day';
    const scope: string = record.scope || '';
    const isFireInitial = disaster === '화재' && scope === 'fire_initial';
    const nightDutyGroup: string | null =
      shift === 'night' && typeof record.night_duty_group === 'string' && record.night_duty_group
        ? record.night_duty_group
        : null;

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

    // 화재 필수 연락망 — 배지/확인여부 판단(30초 대기) 이전에 즉시 발신.
    // 이 8명은 주간 근무 파트장급이라 야간엔 퇴근 상태 — 야간(shift='night')은 대상에서 제외(2026-07-24).
    let mustCallCount = 0;
    if (disaster === '화재' && shift !== 'night') {
      const { data: mustCallRows } = await supabase
        .from('employees')
        .select('phone')
        .in('emp_no', FIRE_MUST_CALL_EMP_NOS)
        .not('phone', 'is', null);
      const mustCallPhones = (mustCallRows ?? []).map((e: { phone: string }) => e.phone).filter(Boolean);
      const immediateText = isTraining
        ? `훈련상황입니다. 화재 훈련. ${location}. 확인 바랍니다.`
        : `화재 발생. ${location}. 즉시 확인 바랍니다.`;
      const mustCallResult = await sendVoiceCalls(mustCallPhones, immediateText);
      mustCallCount = mustCallResult.sent;
      if (!mustCallResult.ok && mustCallPhones.length > 0) {
        console.error(`필수연락망 발신 실패(incident=${incidentId}):`, mustCallResult.error);
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
    // 2026-07-24: mode 문자열에 "감지기"가 포함되는지(LIKE) 대신, 그 단계에서 실제로 저장해둔
    // scope='fire_initial' 값으로 판정 — mode 이름 짓는 규칙이 바뀌어도 안 깨짐.
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

    // 대상 배지 범위 결정. 화재 야간은 총괄/통제/출동 배지 체계 자체가 없으므로(주간 전용
    // 파트장 개념) 이 좁은 필터를 적용하지 않고, 그 재난·야간에 배정된 배지를 그대로 대상으로 함.
    let badgeQuery = supabase
      .from('employee_disaster_badges')
      .select('emp_no')
      .eq('disaster', disaster)
      .eq('shift', shift);
    if (isTraining) {
      // 훈련은 전화까지 걸리면 번거로우니 각 조 통제자에게만 확인 전화
      badgeQuery = badgeQuery.in('badge', ['통제']);
    } else if (isFireInitial && shift !== 'night') {
      badgeQuery = badgeQuery.in('badge', FIRE_INITIAL_BADGES);
    } else if (disaster === '화재' && shift !== 'night' && fireInitialAlreadyHandled) {
      // 감지기동작 단계에서 이미 다룬 3배지를 제외한 나머지 전원
      badgeQuery = badgeQuery.not('badge', 'in', `(${FIRE_INITIAL_BADGES.join(',')})`);
    } else if (disaster === '화재') {
      // 야간(모든 단계) 또는 감지기동작 없이 곧바로 전체화재로 발령된 경우(주간) —
      // 제외하지 않고 그 shift에 배정된 전 배지를 대상으로 함
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
    let targetEmpNos = [...new Set((badgeRows ?? []).map((r: { emp_no: string }) => r.emp_no))];

    // 화재 야간 + 오늘 근무조 지정됨 — 그 조(A/B/C/D) 소속으로만 좁힘(2026-07-24).
    // 4교대라 배지만으로는 "오늘 실제로 근무 중인 사람"을 못 가려서, 비번인 나머지 3개조까지
    // 전화가 가던 문제 해결. 지정 안 돼 있으면(구형 발령 등) 기존처럼 전체 대상 유지.
    if (nightDutyGroup && targetEmpNos.length > 0) {
      const { data: groupRows, error: groupErr } = await supabase
        .from('employees')
        .select('emp_no')
        .eq('shift_group', nightDutyGroup)
        .in('emp_no', targetEmpNos);
      if (groupErr) throw new Error('근무조 필터 조회 오류: ' + groupErr.message);
      targetEmpNos = (groupRows ?? []).map((r: { emp_no: string }) => r.emp_no);
    }

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
