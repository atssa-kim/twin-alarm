/**
 * 화재 대응 variant(상황 확정) 기능 — 데이터 마이그레이션 (2026-07-08)
 * 실행: npx tsx scripts/fix-fire-variants-260708.ts
 *
 * 사전 준비: Archive/migration_variant.sql 을 Supabase SQL Editor에서 먼저 실행
 *           (disaster_tasks/member_tasks/incidents에 variant 컬럼 추가).
 *
 * 하는 일 (화재/day, 통제·출동 배지만 대상 — 다른 재난은 건드리지 않음):
 *   1. 출동: "◇음식점 주방 식용류 화재시" / "◇가스방호구역 화재시" 헤더 행 삭제,
 *      그 하위 ┖ 항목들은 ┖ 접두어를 떼고 variant='K급주방' / '가스구역' 태그.
 *   2. 통제: 같은 조건부 안내가 disaster_tasks에 이미 존재하지 않아(과거 편집 중 소실 추정)
 *      disa_app 소스 스냅샷에 남아있던 문구를 그대로 복원해 동일하게 variant 태그로 추가.
 *   3. 통제·출동 각각에 신규 variant='배터리' 임무 2건 추가.
 *
 * 재실행해도 안전(idempotent) — 이미 처리된 부분은 건너뜁니다.
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

async function updateTask(id: number, updates: Partial<Pick<TaskRow, 'task_idx' | 'label' | 'variant'>>) {
  const { error } = await supabase.from('disaster_tasks').update(updates).eq('id', id);
  if (error) throw error;
}

async function deleteTask(id: number) {
  const { error } = await supabase.from('disaster_tasks').delete().eq('id', id);
  if (error) throw error;
}

async function insertTasks(roleId: number, rows: { task_idx: number; label: string; variant: string }[]) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('disaster_tasks')
    .insert(rows.map(r => ({ role_id: roleId, ...r })));
  if (error) throw error;
}

// ── 출동: 기존 ◇┖ 조건부 블록 → variant 태그로 전환 ─────────────
async function fixDispatch() {
  console.log('\n[출동] 처리 시작');
  const { roleId, tasks } = await getRoleWithTasks('출동');

  const kHeader = tasks.find(t => t.label === '◇음식점 주방 식용류 화재시');
  const gHeader = tasks.find(t => t.label === '◇가스방호구역 화재시 (#발전기,변전실,상황실등 현황도면 참조)');

  if (!kHeader && !gHeader) {
    console.log('  ⏭  헤더가 이미 없음 — ①②단계는 이전에 처리됨, 건너뜀');
  } else {
    if (kHeader) {
      const idx = tasks.indexOf(kHeader);
      const subs = tasks.slice(idx + 1).filter(t => (t.label.startsWith('┖') || t.label.startsWith('└')));
      // gHeader 이전까지만 K급 서브로 간주
      const gIdx = gHeader ? tasks.indexOf(gHeader) : tasks.length;
      const kSubs = subs.filter(t => tasks.indexOf(t) < gIdx);
      for (const t of kSubs) {
        await updateTask(t.id, { label: t.label.replace(/^[┖└]\s*/, ''), variant: 'K급주방' });
      }
      await deleteTask(kHeader.id);
      console.log(`  ✓ K급주방: 서브 ${kSubs.length}건 variant 태그, 헤더 삭제`);
    }
    if (gHeader) {
      const gIdx = tasks.indexOf(gHeader);
      const gSubs = tasks.slice(gIdx + 1).filter(t => (t.label.startsWith('┖') || t.label.startsWith('└')));
      for (const t of gSubs) {
        await updateTask(t.id, { label: t.label.replace(/^[┖└]\s*/, ''), variant: '가스구역' });
      }
      await deleteTask(gHeader.id);
      console.log(`  ✓ 가스구역: 서브 ${gSubs.length}건 variant 태그, 헤더 삭제`);
    }
  }

  const existingBattery = tasks.some(t => t.variant === '배터리');
  if (existingBattery) {
    console.log('  ⏭  배터리 임무 이미 존재 — 건너뜀');
    return;
  }
  const maxIdx = Math.max(...tasks.map(t => t.task_idx));
  await insertTasks(roleId, [
    { task_idx: maxIdx + 1, label: '질식소화포 사용(보유 시), 배터리 직접 주수 금지·냉각 위주', variant: '배터리' },
    { task_idx: maxIdx + 2, label: '열폭주 징후(재발화·가스분출) 감시 및 상황실 보고', variant: '배터리' },
  ]);
  console.log('  ✓ 배터리 임무 2건 추가');
}

// ── 통제: disa_app 정적 스냅샷 문구로 복원 + variant 태그 ─────────
async function fixControl() {
  console.log('\n[통제] 처리 시작');
  const { roleId, tasks } = await getRoleWithTasks('통제');

  const already = tasks.some(t => t.variant === 'K급주방' || t.variant === '가스구역');
  if (already) {
    console.log('  ⏭  K급주방/가스구역 임무가 이미 존재 — 건너뜀');
  } else {
    // task_idx >= 2 인 기존 임무를 뒤로 8칸 밀어 자리 확보 (내림차순으로 갱신해 충돌 방지)
    const toShift = tasks.filter(t => t.task_idx >= 2).sort((a, b) => b.task_idx - a.task_idx);
    for (const t of toShift) {
      await updateTask(t.id, { task_idx: t.task_idx + 8 });
    }
    await insertTasks(roleId, [
      { task_idx: 2, label: 'K급소화기 사용 지시 / 물사용 절대금지 지시', variant: 'K급주방' },
      { task_idx: 3, label: '상업용주방소화장치 수동기동 지시', variant: 'K급주방' },
      { task_idx: 4, label: '가스차단, 전기(분전반-전열) 차단 지시', variant: 'K급주방' },
      { task_idx: 5, label: '필요시(상황판단) 주방배기 지시', variant: 'K급주방' },
      { task_idx: 6, label: '방호구역 약제방출상태 확인', variant: '가스구역' },
      { task_idx: 7, label: '미방출시 현장진입 > 화재여부 확인 > 화재시 소화기 초기소화', variant: '가스구역' },
      { task_idx: 8, label: '방출시 진입금지 > 상황실 방출시간 확인 > 10분 후 진입', variant: '가스구역' },
      { task_idx: 9, label: '환기 및 소화조 방화복 및 공기호흡기 착용 후 진입지시', variant: '가스구역' },
    ]);
    console.log(`  ✓ K급주방 4건 + 가스구역 4건 추가, 기존 임무 ${toShift.length}건 뒤로 밀림`);
  }

  const existingBattery = tasks.some(t => t.variant === '배터리');
  if (existingBattery) {
    console.log('  ⏭  배터리 임무 이미 존재 — 건너뜀');
    return;
  }
  const maxIdx = Math.max(...tasks.map(t => t.task_idx), 9) + (already ? 0 : 8);
  await insertTasks(roleId, [
    { task_idx: maxIdx + 1, label: '전기차(EV) 여부 확인 — EV시 배터리 직접 주수 금지 지시', variant: '배터리' },
    { task_idx: maxIdx + 2, label: '인접 차량 이격 또는 연소확대 방지 지시', variant: '배터리' },
  ]);
  console.log('  ✓ 배터리 임무 2건 추가');
}

async function run() {
  await fixDispatch();
  await fixControl();
  console.log('\n완료! twin-alarm 다음 화재 발령 시 반영됩니다.\n');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
