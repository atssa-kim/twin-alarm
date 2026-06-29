// Supabase Edge Function: generate-report
// 필요 Supabase Secret:
//   ANTHROPIC_API_KEY - Anthropic API Key (claude-haiku-4-5)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret not set');

    const body = await req.json();
    const { incident, responders, tasks, activityLog } = body;

    // 통계 계산
    const dispatching = responders.filter((r: any) => r.status === '출동중').length;
    const onsite     = responders.filter((r: any) => r.status === '현장').length;
    const returned   = responders.filter((r: any) => r.status === '복귀').length;
    const notResp    = responders.filter((r: any) => r.status === '미응답').length;

    const checkable  = tasks.filter((t: any) => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
    const done       = checkable.filter((t: any) => t.done).length;
    const pct        = checkable.length > 0 ? Math.round(done / checkable.length * 100) : 0;

    const declaredAt = new Date(incident.declared_at);
    const fmtKr = (d: Date) =>
      `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 `
      + `${String(d.getHours()).padStart(2,'0')}시${String(d.getMinutes()).padStart(2,'0')}분`;

    const timeline = (activityLog as any[])
      .map((e: any) => {
        const d = new Date(e.time);
        const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        return `  ${t} ${e.text}${e.sub ? ' (' + e.sub + ')' : ''}`;
      })
      .join('\n');

    const roleGroups: Record<string, any[]> = {};
    for (const t of checkable) { (roleGroups[t.role] ??= []).push(t); }
    const roleStatus = Object.entries(roleGroups)
      .map(([role, ts]) => `  ${role}: ${ts.filter(t => t.done).length}/${ts.length}건 완료`)
      .join('\n');

    const prompt = `당신은 재난 대응 시스템의 상황 보고서 작성 전문가입니다.
아래 실시간 데이터를 바탕으로 공식 재난 대응 상황보고서를 한국어로 작성해주세요.

=== 발령 정보 ===
재난 유형: ${incident.disaster}
발령 구분: ${incident.mode}
발생 위치: ${incident.location}
발령 시각: ${fmtKr(declaredAt)}

=== 대원 출동 현황 (총 ${responders.length}명) ===
출동중: ${dispatching}명 | 현장: ${onsite}명 | 복귀: ${returned}명 | 미응답: ${notResp}명

=== 임무 수행 현황 (완수율 ${pct}%) ===
${roleStatus}

=== 활동 타임라인 ===
${timeline || '  (기록 없음)'}

=== 보고서 작성 지침 ===
아래 형식으로 간결하고 공문서적인 보고서를 작성하세요:

## 재난 대응 상황보고서

**1. 상황 개요**
(재난 유형, 위치, 발령 시각을 바탕으로 2~3줄 요약)

**2. 대원 출동 현황**
(출동/현장/복귀/미응답 수치와 함께 현황 설명)

**3. 임무 수행 진행 상황**
(완수율과 역할별 임무 수행 상태 요약)

**4. 현재 상황 평가**
(타임라인과 수치를 종합한 1~2줄 평가)

**5. 권장 후속 조치**
(데이터에 근거한 2~3가지 구체적 조치 사항)`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Anthropic API error ${resp.status}: ${err}`);
    }

    const result = await resp.json();
    const report: string = result.content?.[0]?.text ?? '';

    return new Response(JSON.stringify({ report }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('generate-report error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
