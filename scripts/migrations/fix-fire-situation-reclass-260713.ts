/**
 * 화재/day(상황)·night(통제=상황실 역할) 임무를 4개 카테고리로 재분류 (2026-07-13)
 * 실행: npx tsx scripts/migrations/fix-fire-situation-reclass-260713.ts
 *
 * 1분이내 임무 / 1분이후 임무 / 비화재보시 임무 / 화재시 임무(화재시 설비연동+
 * 화재시 비상연락+화재진압후 통합) 4개 그룹으로 헤더를 정리하고, "◇임무)" 접두어로
 * 통일 — 렌더링 쪽에서 tag==='임무'일 때 "🔀 상황분기" 심벌을 표시하지 않도록 처리됨
 * (disa_app index.html의 renderMemberList에서 별도 반영).
 *
 * 각 ┖ 하위 임무 문구는 그대로 유지, 헤더만 정리/병합. day·night 문구가 서로 달라
 * (예: day "비화재보 처리 (비화재보 판명시)" vs night "비화재보") 부분 문자열로 매칭.
 *
 * 재실행해도 안전(idempotent) — 이미 "◇임무)"로 시작하면 건너뜁니다.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');
const env: Record<string, string> = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const eq = line.indexOf('=');
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ .env에 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

type TaskRow = { id: number; task_idx: number; label: string; variant: string | null };

async function getRoleWithTasks(shift: string, badge: string) {
  const { data, error } = await supabase
    .from('disaster_roles')
    .select('id, disaster_tasks(id, task_idx, label, variant)')
    .eq('disaster', '화재').eq('shift', shift).eq('badge', badge).single();
  if (error) throw error;
  const tasks = (data.disaster_tasks as TaskRow[]).slice().sort((a, b) => a.task_idx - b.task_idx);
  return { roleId: data.id as number, tasks };
}

async function updateLabel(id: number, label: string) {
  const { error } = await supabase.from('disaster_tasks').update({ label }).eq('id', id);
  if (error) throw error;
}
async function updateIdx(id: number, task_idx: number) {
  const { error } = await supabase.from('disaster_tasks').update({ task_idx }).eq('id', id);
  if (error) throw error;
}
async function deleteTask(id: number) {
  const { error } = await supabase.from('disaster_tasks').delete().eq('id', id);
  if (error) throw error;
}

function classify(label: string): 'header-1min' | 'header-after' | 'header-false' | 'header-fire-keep' | 'header-fire-drop' | null {
  if (!label.startsWith('◇')) return null;
  if (label.includes('1분') && label.includes('이내')) return 'header-1min';
  if (label.includes('1분') && label.includes('이후')) return 'header-after';
  if (label.includes('비화재보')) return 'header-false';
  if (label.includes('화재시 설비')) return 'header-fire-keep';
  if (label.includes('화재시 비상연락') || label.includes('화재진압')) return 'header-fire-drop';
  return null;
}

async function reclassify(shift: string, badge: string) {
  const { tasks } = await getRoleWithTasks(shift, badge);
  if (tasks.some(t => t.label.startsWith('◇임무)'))) {
    console.log(`⏭  [${shift}/${badge}] 이미 재분류됨 — 건너뜀`);
    return;
  }

  for (const t of tasks) {
    const kind = classify(t.label);
    if (kind === 'header-1min') await updateLabel(t.id, '◇임무) 1분이내 임무');
    else if (kind === 'header-after') await updateLabel(t.id, '◇임무) 1분이후 임무');
    else if (kind === 'header-false') await updateLabel(t.id, '◇임무) 비화재보시 임무');
    else if (kind === 'header-fire-keep') await updateLabel(t.id, '◇임무) 화재시 임무');
    else if (kind === 'header-fire-drop') await deleteTask(t.id);
  }

  // task_idx 재정렬 (0..N-1, 상대 순서 유지 — 이미 정렬된 tasks 배열 기준으로 삭제분만 제외)
  const remaining = tasks.filter(t => classify(t.label) !== 'header-fire-drop');
  for (const t of remaining) await updateIdx(t.id, t.task_idx + 1000); // 충돌 방지 오프셋
  for (let i = 0; i < remaining.length; i++) await updateIdx(remaining[i].id, i);

  console.log(`✓ [${shift}/${badge}] 재분류 완료 — ${remaining.length}건 (기존 ${tasks.length}건에서 헤더 2건 삭제)`);
}

async function run() {
  await reclassify('day', '상황');
  await reclassify('night', '통제');
  console.log('\n완료!\n');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
