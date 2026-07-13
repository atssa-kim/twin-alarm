/**
 * 화재/day/통제(소방안전관리자) 임무 순서 재배치 (2026-07-13)
 * 실행: npx tsx scripts/migrations/fix-fire-control-reorder-260713.ts
 *
 * K급주방 뒤에 흩어져 있던 공통 임무들을 뒤로 밀고, 가스구역·UPS실·지하주차장을
 * K급주방 바로 다음에 이어 붙임. 최종 순서: 공통(선두) → K급주방 → 가스구역 →
 * UPS실 → 지하주차장 → 공통(나머지). 각 그룹 내부 상대 순서는 그대로 유지.
 *
 * 재실행해도 안전(idempotent) — 이미 이 순서면 아무 것도 하지 않습니다.
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

async function getTasks() {
  const { data, error } = await supabase
    .from('disaster_roles')
    .select('id, disaster_tasks(id, task_idx, label, variant)')
    .eq('disaster', '화재').eq('shift', 'day').eq('badge', '통제').single();
  if (error) throw error;
  const tasks = (data.disaster_tasks as TaskRow[]).slice().sort((a, b) => a.task_idx - b.task_idx);
  return tasks;
}

async function updateIdx(id: number, task_idx: number) {
  const { error } = await supabase.from('disaster_tasks').update({ task_idx }).eq('id', id);
  if (error) throw error;
}

async function run() {
  const tasks = await getTasks();
  const firstKIdx = tasks.find(t => t.variant === 'K급주방')?.task_idx ?? Infinity;

  const headCommon = tasks.filter(t => !t.variant && t.task_idx < firstKIdx);
  const kitchen = tasks.filter(t => t.variant === 'K급주방');
  const gas = tasks.filter(t => t.variant === '가스구역');
  const ups = tasks.filter(t => t.variant === 'UPS실');
  const parking = tasks.filter(t => t.variant === '지하주차장');
  const tailCommon = tasks.filter(t => !t.variant && t.task_idx >= firstKIdx);

  const desired = [...headCommon, ...kitchen, ...gas, ...ups, ...parking, ...tailCommon];

  const alreadyInOrder = desired.every((t, i) => t.task_idx === i);
  if (alreadyInOrder) {
    console.log('⏭  이미 원하는 순서 — 건너뜀');
    return;
  }

  // 1단계: 충돌 방지를 위해 전부 큰 오프셋으로 이동
  for (const t of tasks) {
    await updateIdx(t.id, t.task_idx + 1000);
  }
  // 2단계: 최종 순서로 재배치
  for (let i = 0; i < desired.length; i++) {
    await updateIdx(desired[i].id, i);
  }
  console.log(`✓ 재배치 완료 — 공통(${headCommon.length}) → K급주방(${kitchen.length}) → 가스구역(${gas.length}) → UPS실(${ups.length}) → 지하주차장(${parking.length}) → 공통(${tailCommon.length})`);
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
