// ─── SOLAPI 공유 유틸 ─────────────────────────────────────────────────────────
// notify-incident(SMS+카카오 알림톡)와 escalate-unacked-calls(TTS 전화)가
// 완전히 동일한 HMAC 서명·발신번호 검증·send-many 호출 로직을 각자 갖고 있던 것을
// 하나로 합침(2026-07-20). Supabase Edge Function은 배포 시 상대경로 import를
// 그대로 번들에 포함시키므로, 여러 함수가 나눠 쓰는 이 파일은 따로 배포할 필요 없음.
//
// 필요 Supabase Secrets: SOLAPI_API_KEY, SOLAPI_API_SECRET, SENDER_PHONE

export interface SolapiMessage {
  to: string;
  from: string;
  type: 'LMS' | 'ATA' | 'CTI';
  [key: string]: unknown;
}

export async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 발신 가능한 국내 번호 형식만 남김(하이픈/공백 제거 후 0으로 시작하는 10~11자리)
export function normalizePhones(phones: string[]): string[] {
  return phones
    .map(p => p.replace(/[-\s]/g, ''))
    .filter(p => /^0\d{9,10}$/.test(p));
}

// 이미 검증된 메시지 배열을 SOLAPI send-many로 발송. apiKey/apiSecret 미설정 시 조용히 스킵.
export async function sendSolapiMessages(
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
