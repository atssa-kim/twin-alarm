/**
 * disa_app 마스터 계정(김견수) 비밀번호 초기화 (2026-09-08)
 * 실행: npx tsx scripts/migrations/reset-kyensu-260908.ts
 * 새 임시 비밀번호는 콘솔에만 출력됩니다 — 안전한 채널로 전달하세요.
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

function randomPassword(): string {
  return Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-6).toUpperCase() + '!1';
}

async function run() {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const user = list.users.find(u => u.email === 'kyensu_kim@sni.co.kr');
  if (!user) { console.log('✗ kyensu_kim@sni.co.kr 계정을 찾을 수 없음'); return; }

  const password = randomPassword();
  const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (error) throw error;
  console.log(`✓ kyensu_kim@sni.co.kr (소방파트장 김견수 — 마스터) — 새 임시 비밀번호: ${password}`);
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
