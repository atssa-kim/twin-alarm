import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── SOLAPI 보이스(TTS 전화) 에스컬레이션 ────────────────────────────────────
// 발령/승격 후 30초가 지나도 앱을 열어보지 않은 대상자에게만 전화를 겁니다.
// 발령 시 "TTS 전화 사용"을 해제한 경우는 완전히 제외.
// 30초는 골든타임(3분) 안에서 최대한 빨리 잡기 위한 값 — 짧을수록 정상적으로
// 반응 중인 사람에게도 전화가 걸릴 가능성이 커지는 트레이드오프가 있음(2026-07-16 논의).
//
// 대상자 범위 (2026-07-16b, 2026-07-20 수정, 2026-07-20c 훈련 범위 추가):
//   훈련(mode가 '훈련'으로 시작)                        → 통제(각 조 통제자)만 — 훈련마다 전 대원에게
//     전화까지 걸리면 번거로우니 확인 전화는 조 대표자에게만 감. (2026-07-23: 참여인원설정에서
//     사람별로 TTS 수신자를 따로 고르는 기능을 시도했다가, 실제 상황엔 영향 없는 훈련 전용
//     기능인데도 UI만 복잡해져서 도로 걷어냄 — 필요해지면 이 파일 git 이력의 2026-07-23 커밋 참고)
//   화재 감지기동작(scope='fire_initial')               → 총괄/통제/출동
//   화재 전체화재, 감지기동작 단계를 이미 거친 경우      → 총괄/통제/출동을 "제외한" 나머지 전 배지
//   화재 전체화재를 감지기동작 없이 곧바로 발령한 경우   → 전 배지(제외 없음) — 총괄/통제/출동이
//     한 번도 에스컬레이션 대상이 된 적 없으므로 여기서 빠지면 아무도 안 걸림(2026-07-20 발견된 버그)
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

// 화재 필수 연락망 — 배지·확인여부·30초 대기와 무관하게 화재 발령/승격 즉시 무조건 전화
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

async function sendVoiceCalls(phones: string[], text: string): Promise<void> {
  const apiKey = Deno.env.get('SOLAPI_API_KEY');
  const apiSecret = Deno.env.get('SOLAPI_API_SECRET');
  const senderPhone = Deno.env.get('SENDER_PHONE');
  if (!senderPhone) return;

  const validPhones = normalizePhones(phones);
  const messages: SolapiMessage[] = validPhones.map(to => ({
    to,
    from: senderPhone.replace(/[-\s]/g, ''),
    type: 'CTI', // SOLAPI 음성(TTS 전화) 메시지 타입
    text: text.slice(0, 490), // 한글 최대 490자
    voiceOptions: { voiceType: 'FEMALE' },
  }));
  await sendSolapiMessages(messages, { apiKey, apiSecret }, 'Voice');
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
    const mode: string = record.mode || '';
    const isTraining = mode.startsWith('훈련');
    if (record.tts_call_enabled === false) {
      return new Response('tts call disabled at declare time', { status: 200, headers: CORS });
    }

    const incidentId: string = record.id;
    const disaster: string = record.disaster || '';
    const location: string = record.location || '';
    const shift: string = record.shift || 'day';
    const scope: string = record.scope || '';
    const isFireInitial = disaster === '화재' && scope === 'fire_initial';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // (incident_id, mode) 단위로 먼저 선점 — 유니크 제약 위반이면 이미 처리 중/완료된 것
    const { error: claimErr } = await supabase
      .from('incident_call_escalations')
      .insert({ incident_id: incidentId, mode, escalated_at: Date.now() });
    if (claimErr) {
      return new Response('skip: already escalated for this mode', { status: 200, headers: CORS });
    }

    // 화재 필수 연락망 — 배지/확인여부 판단(30초 대기) 이전에 즉시 발신.
    // 이 8명은 주간 근무 파트장급이라 야간엔 퇴근 상태 — 야간(shift='night')은 대상에서 제외(2026-07-24).
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
      await sendVoiceCalls(mustCallPhones, immediateText);
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
      return new Response('skip: incident closed', { status: 200, headers: CORS });
    }

    // 화재 전체화재 단계라면, 감지기동작 단계가 "이 사건에서 실제로 먼저 처리됐는지" 확인.
    // (claim은 대상자 유무와 무관하게 항상 남으므로, 존재 여부만으로 판단 가능)
    let fireInitialAlreadyHandled = false;
    if (!isTraining && disaster === '화재' && !isFireInitial) {
      const { data: priorInitial } = await supabase
        .from('incident_call_escalations')
        .select('mode')
        .eq('incident_id', incidentId)
        .like('mode', '%감지기%')
        .maybeSingle();
      fireInitialAlreadyHandled = !!priorInitial;
    }

    // 대상 배지 범위 결정
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
      return new Response(JSON.stringify({ called: 0, reason: 'no targets' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
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

    const ttsText = isTraining
      ? `훈련상황입니다. ${disaster} 훈련. ${location}. 통제관 확인 바랍니다.`
      : isFireInitial
        ? `화재감지기 동작. ${location}. 확인 바랍니다.`
        : `${disaster} 발생. ${location}. 즉시 대응 바랍니다.`;
    await sendVoiceCalls(phones, ttsText);

    return new Response(JSON.stringify({ called: phones.length, targets: unackedEmpNos.length }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('escalate-unacked-calls error:', message);
    return new Response(JSON.stringify({ error: 'internal error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
