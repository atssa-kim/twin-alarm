/**
 * 배지명 표준화 (2026-07-06)
 * 실행: npm run fix-badges-260706
 *
 * 재난마다 제각각이던 배지 이름을 표준 어휘로 통일합니다.
 * 표준 배지: 총괄·통제·상황·출동·대응·유도·응급·방호·경계·복구·지원
 *   (대응·유도·지원 3개만 필요시 대응1/대응2, 유도1/유도2, 지원1/지원2 로 세분화 허용)
 *
 * 매핑 결정 (2026-07-06 확정, 보안 매핑은 2026-07-07에 통제→지원으로 정정):
 *   대피 → 유도 / 구조 → 응급 / 의료 → 응급 / 보안 → 지원 / 관리 → 지원
 *   복구E·복구B → 복구로 통합
 *   테러의 '대응2'는 짝인 '대응1'이 없어 그냥 '대응'으로 정규화
 *
 * 단순 리네임은 UPDATE만(임무 내용 유지), 같은 재난에 이미 목표 배지가 있는 경우엔
 * (누수의 응급+의료, 복구E+복구B) 임무를 합치고 원본 역할을 삭제합니다.
 *
 * 재실행해도 안전(idempotent) — 이미 처리된 배지/역할은 찾아지지 않아 건너뜁니다.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');
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

// 충돌 없는 단순 리네임 (같은 재난에 목표 배지가 이미 없음을 사전 확인함)
// 주의: '관리'→'지원'이 먼저 처리되어야 아래 MERGES에서 '보안'을 '지원'에 합칠 수 있음
const SIMPLE_RENAMES: { disaster: string; from: string; to: string }[] = [
  { disaster: '화재', from: '구조', to: '응급' },
  { disaster: '누수', from: '관리', to: '지원' },
  { disaster: '태풍/홍수', from: '구조', to: '응급' },
  { disaster: '지진', from: '대피', to: '유도' },
  { disaster: '지진', from: '구조', to: '응급' },
  { disaster: '가스누출', from: '대피', to: '유도' },
  { disaster: '테러', from: '대응2', to: '대응' },
  { disaster: '테러', from: '구조', to: '응급' },
];

// 같은 재난에 목표 배지가 이미 있어 임무를 합쳐야 하는 경우
const MERGES: { disaster: string; keep: string; mergeFrom: string[] }[] = [
  { disaster: '누수', keep: '응급', mergeFrom: ['의료'] },
  { disaster: '누수', keep: '복구E', mergeFrom: ['복구B'] }, // keep을 임시로 '복구'로 리네임 후 병합
  { disaster: '누수', keep: '지원', mergeFrom: ['보안'] }, // 2026-07-07 정정: 보안조를 통제 대신 지원에 병합
];

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
  console.log('\n[1] 단순 리네임 (충돌 없음)\n');
  for (const { disaster, from, to } of SIMPLE_RENAMES) {
    const { data, error } = await supabase
      .from('disaster_roles')
      .update({ badge: to })
      .eq('disaster', disaster)
      .eq('shift', 'day')
      .eq('badge', from)
      .select();
    if (error) { console.error(`  ✗ [${disaster}] ${from}→${to} 오류:`, error.message); continue; }
    if (!data || data.length === 0) { console.log(`  ⏭  [${disaster}] '${from}' 배지 없음 — 건너뜀`); continue; }
    console.log(`  ✓ [${disaster}] ${from} → ${to} (역할 id=${data[0].id})`);
  }

  console.log('\n[2] 목표 배지가 이미 있어 임무를 합치는 경우\n');
  for (const { disaster, keep, mergeFrom } of MERGES) {
    // '복구E' 처럼 keep 자체가 최종 표준 배지가 아니면(끝에 알파벳) 먼저 '복구'로 리네임
    const finalName = keep.replace(/[A-Z]$/, '');
    let target = await getRole(disaster, keep);
    if (!target) {
      target = await getRole(disaster, finalName);
      if (!target) { console.log(`  ⏭  [${disaster}] '${keep}'/'${finalName}' 역할 없음 — 건너뜀`); continue; }
    } else if (finalName !== keep) {
      const { error } = await supabase.from('disaster_roles').update({ badge: finalName }).eq('id', target.id);
      if (error) { console.error(`  ✗ [${disaster}] ${keep}→${finalName} 리네임 오류:`, error.message); continue; }
      console.log(`  ✓ [${disaster}] ${keep} → ${finalName} 리네임 (역할 id=${target.id})`);
    }

    const sourceRoles = (await Promise.all(mergeFrom.map(b => getRole(disaster, b)))).filter((r): r is RoleRow => !!r);
    if (sourceRoles.length === 0) { console.log(`  ⏭  [${disaster}] 병합할 '${mergeFrom.join(',')}' 역할 없음 — 건너뜀`); continue; }

    const sortByIdx = (tasks: { task_idx: number; label: string }[]) => [...tasks].sort((a, b) => a.task_idx - b.task_idx);
    const mergedLabels = [
      ...sortByIdx(target.disaster_tasks).map(t => t.label),
      ...sourceRoles.flatMap(r => sortByIdx(r.disaster_tasks).map(t => t.label)),
    ];

    const { error: delErr } = await supabase.from('disaster_tasks').delete().eq('role_id', target.id);
    if (delErr) { console.error(`  ✗ [${disaster}] ${finalName} 임무 삭제 오류:`, delErr.message); continue; }
    const { error: insErr } = await supabase.from('disaster_tasks').insert(
      mergedLabels.map((label, idx) => ({ role_id: target.id, task_idx: idx, label }))
    );
    if (insErr) { console.error(`  ✗ [${disaster}] ${finalName} 임무 병합 저장 오류:`, insErr.message); continue; }

    for (const r of sourceRoles) {
      const { error: roleDelErr } = await supabase.from('disaster_roles').delete().eq('id', r.id);
      if (roleDelErr) console.error(`  ✗ [${disaster}] '${r.badge}' 역할 삭제 오류:`, roleDelErr.message);
    }

    console.log(`  ✓ [${disaster}] ${finalName} 역할에 ${mergedLabels.length}개 임무로 병합 (역할 id=${target.id}), 병합원본 ${sourceRoles.length}개 역할 삭제`);
  }

  console.log('\n[3] employee_disaster_badges 도 같은 이름으로 갱신\n');
  const EMP_BADGE_RENAMES: { disaster: string; from: string; to: string }[] = [
    { disaster: '화재', from: '구조', to: '응급' },
    { disaster: '태풍/홍수', from: '구조', to: '응급' },
    { disaster: '지진', from: '구조', to: '응급' },
    { disaster: '지진', from: '대피', to: '유도' },
    { disaster: '가스누출', from: '대피', to: '유도' },
    { disaster: '테러', from: '대피', to: '유도' },
    { disaster: '테러', from: '대응2', to: '대응' },
    { disaster: '누수', from: '관리', to: '지원' },
    { disaster: '누수', from: '보안', to: '지원' },
    { disaster: '누수', from: '복구E', to: '복구' },
    { disaster: '누수', from: '복구B', to: '복구' },
  ];
  for (const { disaster, from, to } of EMP_BADGE_RENAMES) {
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .update({ badge: to })
      .eq('disaster', disaster)
      .eq('badge', from)
      .select();
    if (error) { console.error(`  ✗ [${disaster}] 직원배지 ${from}→${to} 오류:`, error.message); continue; }
    console.log(`  ✓ [${disaster}] 직원배지 ${from} → ${to} (${(data ?? []).length}명)`);
  }

  console.log('\n완료!');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
