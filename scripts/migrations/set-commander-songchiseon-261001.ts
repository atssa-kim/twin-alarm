/**
 * 송치선(E-4002, 소방파트) 비상발령(지휘본부) 권한 부여 — 2026-10-01
 * 실행: npx tsx scripts/migrations/set-commander-songchiseon-261001.ts
 *
 * employees.is_commander를 true로 바꿔 로그인 시 지휘본부(비상발령) 화면으로
 * 들어가도록 한다. 재실행해도 안전(idempotent).
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

const EMP_NO = 'E-4002'; // 송치선

async function run() {
  const { data, error } = await supabase
    .from('employees')
    .update({ is_commander: true })
    .eq('emp_no', EMP_NO)
    .select('emp_no, name, team, is_commander');
  if (error) throw error;
  if (!data || data.length === 0) { console.log(`✗ ${EMP_NO} 직원을 찾지 못했습니다.`); return; }
  console.log('✅ 업데이트 완료:', JSON.stringify(data[0]));
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
