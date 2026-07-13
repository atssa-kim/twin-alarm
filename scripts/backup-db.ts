/**
 * 조직원(employees)·재난 임무(disaster_roles/disaster_tasks) 등 핵심 테이블을
 * 타임스탬프 폴더에 JSON으로 백업.
 *
 * 실행: npx tsx scripts/backup-db.ts
 *
 * 출력: backups/<YYYY-MM-DD_HHmm>/<table>.json (+ _summary.json)
 * backups/ 폴더는 개인정보(전화번호 등)가 포함되므로 .gitignore 처리됨 — 커밋되지 않음.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
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
  console.error('❌ .env에 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.');
  process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 조직원 + 임무(템플릿) 관련 핵심 테이블. 진행 중 재난의 실시간 로그(incidents/responders/
// member_tasks)는 발령마다 새로 쌓이는 운영 데이터라 별도 판단 필요 — 원하면 이 목록에 추가.
const TABLES = [
  'employees',
  'employee_disaster_badges',
  'duty_matrix',
  'disaster_roles',
] as const;

// disaster_roles는 하위 disaster_tasks를 함께 담아야 재난별 임무 전체가 복원 가능
const SELECTS: Record<string, string> = {
  disaster_roles: '*, disaster_tasks(*)',
};

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function run() {
  const outDir = resolve(__dirname, '../backups', timestamp());
  mkdirSync(outDir, { recursive: true });

  const summary: Record<string, number | string> = {};
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select(SELECTS[table] ?? '*');
    if (error) {
      console.error(`❌ [${table}] 백업 실패:`, error.message);
      summary[table] = `ERROR: ${error.message}`;
      continue;
    }
    writeFileSync(resolve(outDir, `${table}.json`), JSON.stringify(data, null, 2), 'utf8');
    summary[table] = data?.length ?? 0;
    console.log(`✓ [${table}] ${data?.length ?? 0}건 백업`);
  }

  writeFileSync(resolve(outDir, '_summary.json'), JSON.stringify({ timestamp: new Date().toISOString(), tables: summary }, null, 2), 'utf8');
  console.log(`\n완료 → ${outDir}`);
}

run().catch(err => { console.error('❌ 백업 실패:', err); process.exit(1); });
