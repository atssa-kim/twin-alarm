/**
 * disa_app 파트장 계정 비밀번호 초기화 + 담당자 교체 (2026-09-08)
 * 실행: npx tsx scripts/migrations/reset-disaster-editors-260908.ts
 *
 * 하는 일:
 *   1. 기존 재난 담당 파트장 계정(이길호·손남열) 비밀번호를 새 임시 비밀번호로 초기화
 *   2. 곽우람(mprokmc@sni.co.kr, 폭설·테러 담당 — employees 테이블에 더 이상 존재하지 않음,
 *      퇴사/보직변경 추정)의 disaster_editors 매핑을 제거하고, 현재 운영파트장 박세훈
 *      (sehunpark@sni.co.kr)을 폭설·테러 담당으로 새로 등록
 *   3. 곽우람의 Supabase Auth 계정 자체는 삭제하지 않고 매핑만 제거(되돌리기 쉬운 조치) —
 *      완전 삭제가 필요하면 별도로 요청.
 *
 * 새 임시 비밀번호는 콘솔에만 출력됩니다(저장하지 않음) — 해당 파트장에게 안전한 채널로 전달하세요.
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

async function resetPassword(email: string, note: string) {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const user = list.users.find(u => u.email === email);
  if (!user) { console.log(`  ✗ [${email}] 계정을 찾을 수 없음`); return; }

  const password = randomPassword();
  const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (error) throw error;
  console.log(`  ✓ ${email} (${note}) — 새 임시 비밀번호: ${password}`);
}

async function ensureUser(email: string): Promise<{ id: string; password: string }> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find(u => u.email === email);
  const password = randomPassword();
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, { password });
    if (error) throw error;
    return { id: existing.id, password };
  }
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  return { id: data.user.id, password };
}

async function run() {
  console.log('[1] 기존 파트장 계정 비밀번호 초기화\n');
  await resetPassword('kannylord@sni.co.kr', '전기파트장 이길호 — 정전·승강기');
  await resetPassword('k43414268@sni.co.kr', '기계파트장 손남열 — 누수·태풍/홍수·가스누출');

  console.log('\n[2] 폭설·테러 담당자 교체: 곽우람 → 박세훈\n');
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const kwak = list.users.find(u => u.email === 'mprokmc@sni.co.kr');
  if (kwak) {
    const { error: delErr } = await supabase.from('disaster_editors').delete().eq('user_id', kwak.id);
    if (delErr) throw delErr;
    console.log(`  - 곽우람(${kwak.email}) 담당 매핑 제거 (계정 자체는 유지)`);
  } else {
    console.log('  ⏭  곽우람 계정을 찾을 수 없음 — 매핑 제거 건너뜀');
  }

  const { id: parkId, password: parkPw } = await ensureUser('sehunpark@sni.co.kr');
  for (const disaster of ['폭설', '테러']) {
    const { error } = await supabase.from('disaster_editors').upsert({ user_id: parkId, disaster });
    if (error) throw error;
  }
  console.log(`  ✓ sehunpark@sni.co.kr (운영파트장 박세훈) → 폭설, 테러 — 새 임시 비밀번호: ${parkPw}`);

  console.log('\n완료! 위 임시 비밀번호를 해당 파트장에게 안전한 채널로 전달하고,');
  console.log('로그인 후 Supabase 계정 비밀번호를 바꾸도록 안내하세요.\n');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
