/**
 * 배지명 정합 패치 (2026-07-04)
 * 실행: npm run fix-badges-260704
 *
 * disaster_roles 테이블에 이미 만들어져 있던 역할의 badge 값만 이름을 바꿉니다.
 * (role_id/disaster_tasks는 그대로 유지 — UPDATE라 기존 임무 내용이 삭제되지 않음)
 *
 * 1. 화재 · 소화조(기계파트): badge '소화' → '조치'
 *    - duty_matrix(재난 임무 매트릭스) 및 기존 TEAM_BADGE_MAP과 이름 통일
 * 2. 가스누출 · 총괄자(센터장): badge '지휘' → '총괄'
 *    - 기존에 TEAM_BADGE_MAP은 센터장에게 항상 '총괄' 배지를 주고 있었는데, 가스누출의
 *      disaster_roles에는 '지휘'라는 이름으로만 역할이 있어서 센터장이 임무를 못 보던 버그 수정
 *    - 태풍/홍수·폭설·지진·테러 4개 재난도 동일한 '지휘'/'총괄' 불일치가 있으나, 이번 지시 범위는
 *      가스누출로 한정되어 있어 그대로 둠 (필요 시 별도 요청)
 *
 * 재실행해도 안전(idempotent) — 이미 바뀐 뒤엔 WHERE 조건에 맞는 행이 없어 아무 일도 안 함.
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

const RENAMES: { disaster: string; from: string; to: string; label: string }[] = [
  { disaster: '화재', from: '소화', to: '조치', label: '소화조(기계파트)' },
  { disaster: '가스누출', from: '지휘', to: '총괄', label: '총괄자(센터장)' },
];

async function run() {
  console.log('\n배지명 정합 패치 시작...\n');

  for (const { disaster, from, to, label } of RENAMES) {
    const { data, error } = await supabase
      .from('disaster_roles')
      .update({ badge: to })
      .eq('disaster', disaster)
      .eq('badge', from)
      .select();

    if (error) {
      console.error(`  ✗ [${disaster}] ${label} '${from}'→'${to}' 오류:`, error.message);
      continue;
    }
    if (!data || data.length === 0) {
      console.log(`  ⏭  [${disaster}] ${label} '${from}' 배지가 이미 없음 (재실행이거나 데이터 상이) — 건너뜀`);
      continue;
    }
    console.log(`  ✓ [${disaster}] ${label}: '${from}' → '${to}' (역할 id=${data[0].id})`);
  }

  console.log('\n완료! employee_disaster_badges도 최신 상태로 맞추려면 이어서 npm run seed-employees 를 실행하세요.');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
