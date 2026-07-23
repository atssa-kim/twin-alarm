/**
 * 화재/주간 '상황실'·'상황실/화재' 중복 배지 정리 (2026-07-23)
 * 실행: npx tsx scripts/migrations/fix-badges-260723-dedup-situation-room.ts
 *
 * fix-badges-260705b.ts가 '상황실'/'상황실/화재'를 '상황'에 병합 후 원본 역할을
 * 삭제하도록 설계됐으나, 라이브 DB에 삭제가 반영되지 않아 세 역할이 모두 남아있었음
 * (전체 조직도 다운로드에서 발견). '상황'(id=3, 47건)은 이미 병합+2026-07-13
 * 재분류까지 반영된 최종 내용과 일치함을 확인했으므로, 재병합 없이 중복 역할만
 * 삭제하고 옛 '상황실' 배지를 쓰던 직원만 '상황'으로 재배정한다.
 *
 * 재실행해도 안전(idempotent) — 대상이 없으면 건너뜀.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env: Record<string, string> = {};
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const eq = line.indexOf('=');
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ .env에 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('[1] 직원 배지 재배정: 화재/day 상황실 → 상황\n');
  const { data: moved, error: moveErr } = await supabase
    .from('employee_disaster_badges')
    .update({ badge: '상황' })
    .eq('disaster', '화재').eq('shift', 'day').eq('badge', '상황실')
    .select('emp_no');
  if (moveErr) { console.error('  ✗ 재배정 오류:', moveErr.message); process.exit(1); }
  console.log(`  ✓ ${moved?.length ?? 0}명 재배정 완료`);

  console.log('\n[2] 중복 역할 삭제: 화재/day 상황실, 상황실/화재\n');
  const { data: deleted, error: delErr } = await supabase
    .from('disaster_roles')
    .delete()
    .eq('disaster', '화재').eq('shift', 'day').in('badge', ['상황실', '상황실/화재'])
    .select('id, badge');
  if (delErr) { console.error('  ✗ 삭제 오류:', delErr.message); process.exit(1); }
  (deleted ?? []).forEach(r => console.log(`  ✓ 역할 삭제 (id=${r.id}, badge=${r.badge}) — 임무는 CASCADE로 함께 삭제됨`));
  if (!deleted || deleted.length === 0) console.log('  ⏭  대상 없음 — 이미 처리됨');

  console.log('\n완료!');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
