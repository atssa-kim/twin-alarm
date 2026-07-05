/**
 * 배지명 정합 패치 2차 (2026-07-05)
 * 실행: npm run fix-badges-260705b
 *
 * disa_app 소스코드 수정(지휘→총괄 리네임, 상황실/상황실화재를 상황 역할에 병합)이
 * 라이브 Supabase에는 아직 반영 안 됐던 문제를 직접 고칩니다. disa_app은 페이지를 열 때마다
 * sbLoadDisasters()로 Supabase 값을 불러와 화면을 덮어쓰므로, 소스코드만 고쳐서는 "전체 동기화"
 * 버튼을 눌러도 이미 로드된 옛날 값이 그대로 다시 저장될 뿐이라 disa_app UI로는 반영이 안 됩니다.
 *
 * 1. 배지명 리네임: '지휘' → '총괄' (태풍/홍수·폭설·지진·테러)
 *    - 화재·가스누출은 이전 세션에서 이미 처리됨(fix-badges-260704.ts).
 *
 * 2. 상황실 관련 역할 병합: badge '상황실'(+화재 전용 '상황실/화재')의 임무를
 *    같은 재난의 '상황' 역할에 합치고, '상황실'/'상황실/화재' 역할 자체는 삭제합니다.
 *    - 화재: 상황실(감지기 즉시임무)을 앞에, 상황실/화재(승격 후 추가임무)를 뒤에 붙임
 *    - 폭설·지진: '상황' 역할이 아예 없었으므로 '상황실'의 배지명만 '상황'으로 바꿈(병합 아님)
 *    - 그 외 6개 재난: '상황실' 임무를 '상황' 임무 앞에 붙임
 *
 * 재실행해도 안전(idempotent) — 이미 처리된 배지/역할은 찾아지지 않아 건너뜁니다.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const eq = line.indexOf('=');
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'] || env['VITE_SUPABASE_ANON_KEY'];
if (!env['SUPABASE_SERVICE_ROLE_KEY']) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY 미설정 — anon key 사용 (RLS 활성화 시 쓰기 실패 가능)');
}
const supabase = createClient(env['VITE_SUPABASE_URL'], supabaseKey);

const RENAMES = ['태풍/홍수', '폭설', '지진', '테러'];

const MERGE_TARGETS: { disaster: string; prepend: string[]; append: string[] }[] = [
  { disaster: '화재', prepend: ['상황실'], append: ['상황실/화재'] },
  { disaster: '정전', prepend: ['상황실'], append: [] },
  { disaster: '누수', prepend: ['상황실'], append: [] },
  { disaster: '태풍/홍수', prepend: ['상황실'], append: [] },
  { disaster: '가스누출', prepend: ['상황실'], append: [] },
  { disaster: '승강기', prepend: ['상황실'], append: [] },
  { disaster: '테러', prepend: ['상황실'], append: [] },
];
// 상황 역할 자체가 없던 재난 — 병합이 아니라 상황실 → 상황 리네임만
const RENAME_ONLY = ['폭설', '지진'];

type RoleRow = {
  id: number;
  badge: string;
  disaster_tasks: { task_idx: number; label: string }[];
};

async function getRole(disaster: string, badge: string): Promise<RoleRow | null> {
  const { data, error } = await supabase
    .from('disaster_roles')
    .select('id, badge, disaster_tasks(task_idx, label)')
    .eq('disaster', disaster)
    .eq('shift', 'day')
    .eq('badge', badge)
    .maybeSingle();
  if (error) throw error;
  return data as RoleRow | null;
}

async function run() {
  console.log('\n[1] 지휘 → 총괄 배지명 리네임\n');
  for (const disaster of RENAMES) {
    const { data, error } = await supabase
      .from('disaster_roles')
      .update({ badge: '총괄' })
      .eq('disaster', disaster)
      .eq('shift', 'day')
      .eq('badge', '지휘')
      .select();
    if (error) { console.error(`  ✗ [${disaster}] 지휘→총괄 오류:`, error.message); continue; }
    if (!data || data.length === 0) { console.log(`  ⏭  [${disaster}] '지휘' 배지 없음 — 건너뜀`); continue; }
    console.log(`  ✓ [${disaster}] 지휘 → 총괄 (역할 id=${data[0].id})`);
  }

  console.log('\n[2] 상황실 관련 역할을 상황으로 병합/리네임\n');

  for (const disaster of RENAME_ONLY) {
    const situationRoom = await getRole(disaster, '상황실');
    if (!situationRoom) { console.log(`  ⏭  [${disaster}] '상황실' 역할 없음 — 건너뜀`); continue; }
    const existingSituation = await getRole(disaster, '상황');
    if (existingSituation) {
      console.warn(`  ⚠ [${disaster}] '상황' 역할이 이미 존재합니다 — RENAME_ONLY 목록에서 빼고 병합 로직으로 처리해야 합니다. 건너뜀.`);
      continue;
    }
    const { error } = await supabase.from('disaster_roles').update({ badge: '상황' }).eq('id', situationRoom.id);
    if (error) { console.error(`  ✗ [${disaster}] 상황실→상황 리네임 오류:`, error.message); continue; }
    console.log(`  ✓ [${disaster}] 상황실 → 상황 리네임 (역할 id=${situationRoom.id}, 임무 ${situationRoom.disaster_tasks.length}개 그대로 유지)`);
  }

  for (const { disaster, prepend, append } of MERGE_TARGETS) {
    const target = await getRole(disaster, '상황');
    if (!target) { console.log(`  ⏭  [${disaster}] '상황' 역할이 없어 병합 대상 아님 — 건너뜀`); continue; }

    const prependRoles = (await Promise.all(prepend.map(b => getRole(disaster, b)))).filter((r): r is RoleRow => !!r);
    const appendRoles = (await Promise.all(append.map(b => getRole(disaster, b)))).filter((r): r is RoleRow => !!r);
    if (prependRoles.length === 0 && appendRoles.length === 0) {
      console.log(`  ⏭  [${disaster}] 병합할 상황실 역할이 없음 (이미 처리됨) — 건너뜀`);
      continue;
    }

    const sortByIdx = (tasks: { task_idx: number; label: string }[]) => [...tasks].sort((a, b) => a.task_idx - b.task_idx);
    const mergedLabels = [
      ...prependRoles.flatMap(r => sortByIdx(r.disaster_tasks).map(t => t.label)),
      ...sortByIdx(target.disaster_tasks).map(t => t.label),
      ...appendRoles.flatMap(r => sortByIdx(r.disaster_tasks).map(t => t.label)),
    ];

    const { error: delErr } = await supabase.from('disaster_tasks').delete().eq('role_id', target.id);
    if (delErr) { console.error(`  ✗ [${disaster}] 상황 임무 삭제 오류:`, delErr.message); continue; }
    const { error: insErr } = await supabase.from('disaster_tasks').insert(
      mergedLabels.map((label, idx) => ({ role_id: target.id, task_idx: idx, label }))
    );
    if (insErr) { console.error(`  ✗ [${disaster}] 상황 임무 병합 저장 오류:`, insErr.message); continue; }

    for (const r of [...prependRoles, ...appendRoles]) {
      const { error: roleDelErr } = await supabase.from('disaster_roles').delete().eq('id', r.id);
      if (roleDelErr) console.error(`  ✗ [${disaster}] '${r.badge}' 역할 삭제 오류:`, roleDelErr.message);
    }

    console.log(`  ✓ [${disaster}] 상황 역할에 ${mergedLabels.length}개 임무로 병합 (역할 id=${target.id}), 병합원본 ${prependRoles.length + appendRoles.length}개 역할 삭제`);
  }

  console.log('\n완료!');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
