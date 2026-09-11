/**
 * 시설현황 카테고리명 정정: "실외기 현황 및 도면" → "실외기 현황" (2026-09-11)
 * 실행: npx tsx scripts/migrations/fix-facility-outdoor-label-260911.ts
 *
 * seed-facility-outdoor-260910.ts가 생성한 카테고리의 label만 갱신합니다(항목/도면은 그대로).
 * 재실행해도 안전 — 이미 "실외기 현황"이면 대상이 없어 아무 것도 하지 않습니다.
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

const OLD_LABEL = '실외기 현황 및 도면';
const NEW_LABEL = '실외기 현황';

async function main() {
  const { data, error } = await supabase
    .from('facility_categories')
    .update({ label: NEW_LABEL })
    .eq('label', OLD_LABEL)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    console.log(`ℹ️ "${OLD_LABEL}" 카테고리를 찾지 못했습니다 (이미 정정됐거나 아직 시딩 전).`);
    return;
  }
  console.log(`✅ 카테고리명 정정 완료: "${OLD_LABEL}" → "${NEW_LABEL}" (id=${data.map(d => d.id).join(',')})`);
}

main().catch(e => {
  console.error('❌ 실패:', e);
  process.exit(1);
});
