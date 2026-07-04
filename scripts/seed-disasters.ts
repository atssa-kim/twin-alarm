/**
 * 1회성 seed 스크립트: disasters.ts 데이터 → Supabase disaster_roles / disaster_tasks
 * 실행: npm run seed
 * 주의: supabase_schema.sql 의 disaster_roles, disaster_tasks 테이블이 먼저 생성돼 있어야 합니다.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { DISASTERS } from '../src/data/disasters.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env 파일 수동 파싱 (Node 환경에서 Vite env 미지원)
const envPath = resolve(__dirname, '../.env');
const envRaw = readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
for (const line of envRaw.split('\n')) {
  const eqIdx = line.indexOf('=');
  if (eqIdx > 0) {
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    if (key) env[key] = val;
  }
}

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ .env 파일에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 가 없습니다.');
  process.exit(1);
}
if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY 미설정 — anon key 사용 (RLS 활성화 시 쓰기 실패 가능)');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log('🌱 재난 역할/임무 데이터를 Supabase에 업로드합니다...\n');
  let totalRoles = 0;
  let totalTasks = 0;

  for (const disaster of DISASTERS) {
    console.log(`▶ ${disaster.label} (${disaster.members.length}개 역할)`);

    for (const member of disaster.members) {
      // 역할 upsert (disaster + badge 중복 시 덮어씀)
      const { data: role, error: roleErr } = await supabase
        .from('disaster_roles')
        .upsert(
          {
            disaster: disaster.key,
            group_name: member.group,
            role: member.role,
            badge: member.badge,
            bc: member.bc,
          },
          { onConflict: 'disaster,shift,badge' }
        )
        .select()
        .single();

      if (roleErr) {
        console.error(`  ✗ 역할 오류 [${member.badge}]:`, roleErr.message);
        continue;
      }

      // 기존 임무 항목 삭제 후 재삽입 (clean re-seed)
      await supabase.from('disaster_tasks').delete().eq('role_id', role.id);

      const taskRows = member.tasks.map((label, idx) => ({
        role_id: role.id,
        task_idx: idx,
        label,
      }));

      const { error: taskErr } = await supabase.from('disaster_tasks').insert(taskRows);
      if (taskErr) {
        console.error(`  ✗ 임무 오류 [${member.badge}]:`, taskErr.message);
      } else {
        console.log(`  ✓ ${member.badge} (${member.role}) — ${taskRows.length}개 임무`);
        totalRoles++;
        totalTasks += taskRows.length;
      }
    }
    console.log();
  }

  console.log(`✅ Seed 완료: ${totalRoles}개 역할, ${totalTasks}개 임무 항목`);
}

seed().catch((err) => {
  console.error('❌ Seed 실패:', err);
  process.exit(1);
});
