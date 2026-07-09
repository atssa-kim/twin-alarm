/**
 * 화재 시나리오(FIRE_SCENARIOS) → variant 통합 (2026-07-08, 2차)
 * 실행: npx tsx scripts/fix-fire-scenario-variants-260708.ts
 *
 * disa_app에만 있던 "화재 시나리오" 메뉴(주방K급/전기실가스/UPS실/지하주차장 — 배지 9개를
 * 통째로 새로 구성한 훈련용 별도 데이터)를 실제 발령에 반영되는 variant 체계로 흡수합니다.
 *
 *   - 주방K급: 이미 반영된 K급주방 variant로 충분히 커버됨 → 변경 없음
 *   - 전기실·가스방호구역: 기존에 만든 4줄짜리 "가스구역"(통제·출동만)을 지우고,
 *     시나리오에 있던 훨씬 상세한 절차로 교체 — 총괄·상황·출동·대응·응급·유도·경계 7개 배지
 *   - UPS실: 신규 variant 'UPS실' — 위와 동일한 7개 배지
 *   - 지하주차장: 신규 variant '지하주차장' — 총괄·상황·출동·대응·응급·유도·경계·복구 8개 배지
 *   - '배터리'(전기차 배터리, 지난 1차 작업에서 임의로 만든 항목)는 UPS실/지하주차장에 관련
 *     내용이 흡수되므로 통제·출동에서 삭제
 *
 * 재실행해도 안전(idempotent) — 이미 들어간 문구는 다시 넣지 않습니다.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
const env: Record<string, string> = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const eq = line.indexOf('=');
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const scenarioData: Record<string, Record<string, string[]>> = JSON.parse(
  readFileSync(resolve(__dirname, 'fire-scenario-variant-data.json'), 'utf8')
);

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

async function removeBatteryVariant() {
  console.log('\n[정리] 옛 "배터리" variant 삭제 (통제·출동)');
  for (const badge of ['통제', '출동']) {
    const { roleId, tasks } = await getRoleWithTasks(badge);
    const count = tasks.filter(t => t.variant === '배터리').length;
    if (count === 0) { console.log(`  ⏭  [${badge}] 없음 — 건너뜀`); continue; }
    await deleteByVariant(roleId, '배터리');
    console.log(`  ✓ [${badge}] ${count}건 삭제`);
  }
}

async function upgradeGasZone() {
  console.log('\n[가스구역] 업그레이드 (기존 4줄/5줄 → 상세 절차로 교체)');
  const badges = Object.keys(scenarioData['가스구역']);
  for (const badge of badges) {
    const { roleId, tasks } = await getRoleWithTasks(badge);
    const already = tasks.filter(t => t.variant === '가스구역');
    if (already.length > 0) {
      await deleteByVariant(roleId, '가스구역');
      console.log(`  · [${badge}] 기존 가스구역 ${already.length}건 삭제`);
    }
    const fresh = await getRoleWithTasks(badge); // 삭제 후 다시 조회해 정확한 max idx 사용
    const maxIdx = fresh.tasks.length ? Math.max(...fresh.tasks.map(t => t.task_idx)) : -1;
    await appendTasks(roleId, maxIdx + 1, '가스구역', scenarioData['가스구역'][badge]);
    console.log(`  ✓ [${badge}] 신규 ${scenarioData['가스구역'][badge].length}건 추가`);
  }
}

async function addNewScenarioVariant(variantName: string) {
  console.log(`\n[${variantName}] 신규 variant 추가`);
  const badges = Object.keys(scenarioData[variantName]);
  for (const badge of badges) {
    const { roleId, tasks } = await getRoleWithTasks(badge);
    const already = tasks.some(t => t.variant === variantName);
    if (already) { console.log(`  ⏭  [${badge}] 이미 존재 — 건너뜀`); continue; }
    const maxIdx = tasks.length ? Math.max(...tasks.map(t => t.task_idx)) : -1;
    await appendTasks(roleId, maxIdx + 1, variantName, scenarioData[variantName][badge]);
    console.log(`  ✓ [${badge}] ${scenarioData[variantName][badge].length}건 추가`);
  }
}

async function run() {
  await removeBatteryVariant();
  await upgradeGasZone();
  await addNewScenarioVariant('UPS실');
  await addNewScenarioVariant('지하주차장');
  console.log('\n완료! twin-alarm 다음 화재 발령 시 반영됩니다.\n');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
