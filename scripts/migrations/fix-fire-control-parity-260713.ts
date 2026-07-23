/**
 * 화재/day/통제(소방안전관리자)에 출동(비상출동조)과 동일한 UPS실·지하주차장 variant
 * 임무를 추가하고, 구버전 4줄짜리 가스구역을 출동의 신버전 5줄로 교체 (2026-07-13)
 * 실행: npx tsx scripts/migrations/fix-fire-control-parity-260713.ts
 *
 * 배경: fix-fire-scenario-variants-260708.ts가 가스구역/UPS실/지하주차장을
 *       "총괄·상황·출동·대응·응급·유도·경계(·복구)" 배지에만 반영해 통제(소방안전관리자)가
 *       빠졌음. 통제·출동은 기존에 K급주방/가스구역 문구를 완전히 동일하게 공유하던
 *       전례가 있어, 이번에도 출동의 문구를 그대로 복사해 통제에 반영.
 *
 * 재실행해도 안전(idempotent) — 이미 처리된 부분은 건너뜁니다.
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

async function getRoleWithTasks(badge: string) {
  const { data, error } = await supabase
    .from('disaster_roles')
    .select('id, disaster_tasks(id, task_idx, label, variant)')
    .eq('disaster', '화재')
    .eq('shift', 'day')
    .eq('badge', badge)
    .single();
  if (error) throw error;
  const tasks = (data.disaster_tasks as TaskRow[]).slice().sort((a, b) => a.task_idx - b.task_idx);
  return { roleId: data.id as number, tasks };
}

async function deleteByVariant(roleId: number, variant: string) {
  const { error } = await supabase.from('disaster_tasks').delete().eq('role_id', roleId).eq('variant', variant);
  if (error) throw error;
}

async function appendTasks(roleId: number, startIdx: number, variant: string, labels: string[]) {
  if (labels.length === 0) return;
  const rows = labels.map((label, i) => ({ role_id: roleId, task_idx: startIdx + i, label, variant }));
  const { error } = await supabase.from('disaster_tasks').insert(rows);
  if (error) throw error;
}

async function run() {
  const dispatch = await getRoleWithTasks('출동');
  const dispatchLabels = (variant: string) =>
    dispatch.tasks.filter(t => t.variant === variant).map(t => t.label);

  const upsLabels = dispatchLabels('UPS실');
  const parkingLabels = dispatchLabels('지하주차장');
  const gasLabelsNew = dispatchLabels('가스구역');

  console.log(`[출동 기준 문구] UPS실 ${upsLabels.length}건 · 지하주차장 ${parkingLabels.length}건 · 가스구역(신버전) ${gasLabelsNew.length}건`);

  const { roleId, tasks } = await getRoleWithTasks('통제');

  // ── 1) 가스구역 구버전 → 출동과 동일한 신버전으로 교체 ──
  const gasOld = tasks.filter(t => t.variant === '가스구역');
  const gasAlreadyMatches = gasOld.length === gasLabelsNew.length &&
    gasOld.every(t => gasLabelsNew.includes(t.label));
  if (gasAlreadyMatches) {
    console.log('⏭  [가스구역] 이미 출동과 동일 — 건너뜀');
  } else {
    if (gasOld.length > 0) {
      await deleteByVariant(roleId, '가스구역');
      console.log(`· [가스구역] 구버전 ${gasOld.length}건 삭제`);
    }
    const fresh1 = await getRoleWithTasks('통제');
    const maxIdx1 = fresh1.tasks.length ? Math.max(...fresh1.tasks.map(t => t.task_idx)) : -1;
    await appendTasks(roleId, maxIdx1 + 1, '가스구역', gasLabelsNew);
    console.log(`✓ [가스구역] 신버전 ${gasLabelsNew.length}건 추가`);
  }

  // ── 2) UPS실 신규 추가 ──
  const hasUps = tasks.some(t => t.variant === 'UPS실');
  if (hasUps) {
    console.log('⏭  [UPS실] 이미 존재 — 건너뜀');
  } else {
    const fresh2 = await getRoleWithTasks('통제');
    const maxIdx2 = fresh2.tasks.length ? Math.max(...fresh2.tasks.map(t => t.task_idx)) : -1;
    await appendTasks(roleId, maxIdx2 + 1, 'UPS실', upsLabels);
    console.log(`✓ [UPS실] ${upsLabels.length}건 추가`);
  }

  // ── 3) 지하주차장 신규 추가 ──
  const hasParking = tasks.some(t => t.variant === '지하주차장');
  if (hasParking) {
    console.log('⏭  [지하주차장] 이미 존재 — 건너뜀');
  } else {
    const fresh3 = await getRoleWithTasks('통제');
    const maxIdx3 = fresh3.tasks.length ? Math.max(...fresh3.tasks.map(t => t.task_idx)) : -1;
    await appendTasks(roleId, maxIdx3 + 1, '지하주차장', parkingLabels);
    console.log(`✓ [지하주차장] ${parkingLabels.length}건 추가`);
  }

  console.log('\n완료! twin-alarm/disa_app 다음 화재 발령·조회 시 반영됩니다.\n');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
