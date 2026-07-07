/**
 * disa_app 파트장별 임무 수정 권한 — Supabase Auth 계정 + 매핑 생성 (2026-07-07)
 * 실행: npx tsx scripts/setup-disaster-editors.ts
 *
 * 사전 준비: disa_app/supabase_auth_setup.sql 을 Supabase SQL Editor에서 먼저 실행
 *           (app_admins, disaster_editors 테이블 + 쓰기 RLS 정책 생성).
 *
 * 이 스크립트는 SUPABASE_SERVICE_ROLE_KEY로 Auth Admin API를 호출해 계정을 만들고,
 * app_admins/disaster_editors 테이블에 매핑을 채웁니다. 이미 있는 이메일은 새로 만들지
 * 않고 기존 계정에 매핑만 추가합니다(재실행해도 안전).
 *
 * 임시 비밀번호는 실행 결과에 콘솔로만 출력됩니다 — 저장하지 않으니 그 자리에서
 * 해당 파트장에게 전달하고, 로그인 후 Supabase 계정 비밀번호를 바꾸도록 안내하세요.
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
  console.error('❌ .env에 SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (Supabase → Settings → API → service_role secret).');
  process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 마스터(전체 재난 수정 가능) 계정
const MASTERS: { email: string; note: string }[] = [
  { email: 'atssa.kim@gmail.com', note: 'atssa.kim (관리자)' },
  { email: 'kyensu_kim@sni.co.kr', note: '소방파트장 김견수' },
];

// 재난별 담당 파트장(자기 담당 재난만 수정 가능)
const EDITORS: { email: string; note: string; disasters: string[] }[] = [
  { email: 'kannylord@sni.co.kr', note: '전기파트장 이길호', disasters: ['정전', '승강기'] },
  { email: 'k43414268@sni.co.kr', note: '기계파트장 손남열', disasters: ['누수', '태풍/홍수', '가스누출'] },
  { email: 'mprokmc@sni.co.kr', note: '운영파트장 곽우람', disasters: ['폭설', '테러'] },
];

function randomPassword(): string {
  return Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-6).toUpperCase() + '!1';
}

async function ensureUser(email: string): Promise<{ id: string; password: string | null }> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find(u => u.email === email);
  if (existing) return { id: existing.id, password: null };

  const password = randomPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user.id, password };
}

async function run() {
  console.log('\n[1] 마스터 계정 (전체 재난 수정 가능)\n');
  for (const m of MASTERS) {
    const { id, password } = await ensureUser(m.email);
    const { error } = await supabase.from('app_admins').upsert({ user_id: id, note: m.note });
    if (error) { console.error(`  ✗ [${m.email}] app_admins 등록 오류:`, error.message); continue; }
    console.log(`  ✓ ${m.email} (${m.note})` + (password ? ` — 임시 비밀번호: ${password}` : ' — 기존 계정 재사용'));
  }

  console.log('\n[2] 재난별 담당 파트장 계정\n');
  for (const e of EDITORS) {
    const { id, password } = await ensureUser(e.email);
    for (const disaster of e.disasters) {
      const { error } = await supabase.from('disaster_editors').upsert({ user_id: id, disaster });
      if (error) console.error(`  ✗ [${e.email}] disaster_editors(${disaster}) 등록 오류:`, error.message);
    }
    console.log(`  ✓ ${e.email} (${e.note}) → ${e.disasters.join(', ')}` + (password ? ` — 임시 비밀번호: ${password}` : ' — 기존 계정 재사용'));
  }

  console.log('\n완료! 위 임시 비밀번호를 해당 파트장에게 안전한 채널로 전달하고,');
  console.log('로그인 후 Supabase 계정 비밀번호를 바꾸도록 안내하세요.\n');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
