/**
 * 방호조(화재) 역할·임무 → Supabase 직접 입력
 * 실행: npx tsx scripts/seed-bangho.ts
 * disasters.ts 의 방호조 임무를 수정한 뒤 이 스크립트를 실행하면 DB에 반영됩니다.
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
const supabase = createClient(env['VITE_SUPABASE_URL'], supabaseKey);

// ── 방호조 임무 (disasters.ts 와 동기화 유지) ─────────────────
const BANGHO = {
  disaster: '화재',
  group_name: '대응반',
  role: '🏗️ 방호조 (건축현장)',
  badge: '방호',
  bc: '#374151',
  tasks: [
    '현장출동 소화등 초기대응',
    '화재실 출입문 미개방시 강제 개방',
    '열,연기확대 방지 조치 (방화문,방화셔터 닫음)',
  ],
};

async function seed() {
  console.log('🌱 방호조(화재) 역할·임무 업로드...');

  // 역할 upsert
  const { data: role, error: rErr } = await supabase
    .from('disaster_roles')
    .upsert(
      { disaster: BANGHO.disaster, group_name: BANGHO.group_name, role: BANGHO.role, badge: BANGHO.badge, bc: BANGHO.bc },
      { onConflict: 'disaster,badge' }
    )
    .select()
    .single();

  if (rErr) { console.error('❌ 역할 오류:', rErr.message); process.exit(1); }
  console.log('✓ 역할 등록:', role.badge, `(id: ${role.id})`);

  // 기존 임무 삭제 후 재삽입
  await supabase.from('disaster_tasks').delete().eq('role_id', role.id);
  const { error: tErr } = await supabase.from('disaster_tasks').insert(
    BANGHO.tasks.map((label, idx) => ({ role_id: role.id, task_idx: idx, label }))
  );
  if (tErr) { console.error('❌ 임무 오류:', tErr.message); process.exit(1); }

  console.log(`✅ 완료: 방호조 ${BANGHO.tasks.length}개 임무 등록`);
  BANGHO.tasks.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
}

seed().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
