/**
 * disa_app 마스터 관리자 추가: 송치선 (소방파트 파트원) — 2026-10-01
 * 실행: npx tsx scripts/migrations/add-admin-songchiseon-261001.ts
 *
 * 하는 일:
 *   1. song5059@sni.co.kr 계정이 없으면 새로 생성(임시 비밀번호는 콘솔에만 출력 —
 *      안전한 채널로 전달할 것), 있으면 기존 계정 재사용.
 *   2. app_admins에 추가 — 전체 재난(disaster_roles/disaster_tasks) + 시설현황
 *      (facility_categories/items/drawings) 편집 권한을 갖는 마스터 계정이 됨.
 *
 * 재실행해도 안전(idempotent) — 이미 app_admins에 있으면 건너뜀.
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

const EMAIL = 'song5059@sni.co.kr';
const NOTE = '소방파트 송치선 (마스터)';

function randomPassword(): string {
  return Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-6).toUpperCase() + '!1';
}

async function run() {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  let user = list.users.find(u => u.email === EMAIL);

  if (!user) {
    const password = randomPassword();
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    user = created.user;
    console.log(`✅ 계정 생성: ${EMAIL} — 임시 비밀번호: ${password} (안전한 채널로 본인에게 전달하세요)`);
  } else {
    console.log(`ℹ️ 기존 계정 재사용: ${EMAIL} (id=${user.id})`);
  }

  const { data: existing } = await supabase.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (existing) {
    console.log('ℹ️ 이미 app_admins에 등록되어 있습니다.');
    return;
  }

  const { error: insErr } = await supabase.from('app_admins').insert({ user_id: user.id, note: NOTE });
  if (insErr) throw insErr;
  console.log(`✅ app_admins 등록 완료: ${EMAIL} (${NOTE})`);
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
