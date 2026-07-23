/**
 * 화재 주간 임무 — PDF(트윈타워_재난조직임무_260708_화재) 기준 반영 (2026-07-09)
 * 실행: npx tsx scripts/migrations/fix-fire-day-pdf-260709.ts
 *
 * 배경: 사용자가 준 PDF는 화재 주간 전체 배지의 최신 임무 문서. 이미 총괄·상황 2개 배지는
 * 엑셀 업로드로 먼저 반영됐는데, 그 과정에서 UPS실/지하주차장 variant 임무가 전부 삭제됨.
 * 사용자 확인: UPS실/지하주차장은 별도로 나중에 입력할 예정이라 이번엔 안 건드림 —
 * PDF에 있는 내용(공통 + K급주방/가스구역)만 반영.
 *
 * 처리 내용:
 *   1. 총괄: 문구 1건 수정 ("디앤오보안" → "보안")
 *   2. 통제: 문구 1건 수정 + 새 공통 임무 1건 추가 (가스구역 뒤, 현장확인 앞)
 *   3. 상황: 빠진 줄 10건 추가 (◇1분이내 하위 2건 + 신규 공통 8건)
 *   4. 출동: 가스구역(전기실·가스방호구역)을 PDF의 5줄짜리 버전으로 교체
 *      (기존 8줄짜리 상세판은 삭제 — 통제와 동일한 문구로 통일)
 *   5. 대응·응급·유도·경계·복구·방호: PDF와 비교 결과 공통 임무 문구 일치, 변경 없음
 *
 * 재실행해도 안전 — 이미 반영된 부분은 텍스트 일치 여부로 건너뜁니다.
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
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

type TaskRow = { id: number; task_idx: number; label: string; variant: string | null };

async function getRoleWithTasks(badge: string) {
  const { data, error } = await supabase
    .from('disaster_roles')
    .select('id, disaster_tasks(id, task_idx, label, variant)')
    .eq('disaster', '화재')
    .eq('shift', 'day')
    .eq('badge', badge)
    .single();
  if (error) throw error;
  const tasks = (data.disaster_tasks as TaskRow[]).slice().sort((a, b) => a.task_idx - b.task_idx);
  return { roleId: data.id as number, tasks };
}

async function updateLabel(id: number, label: string) {
  const { error } = await supabase.from('disaster_tasks').update({ label }).eq('id', id);
  if (error) throw error;
}

async function insertRows(roleId: number, rows: { task_idx: number; label: string; variant: string | null }[]) {
  if (rows.length === 0) return;
  const { error } = await supabase.from('disaster_tasks').insert(rows.map(r => ({ role_id: roleId, ...r })));
  if (error) throw error;
}

async function deleteIds(ids: number[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from('disaster_tasks').delete().in('id', ids);
  if (error) throw error;
}

// ── 1. 총괄 ────────────────────────────────────────────
async function fixChonggwal() {
  console.log('\n[총괄] 문구 수정');
  const { tasks } = await getRoleWithTasks('총괄');
  const old = tasks.find(t => t.label.includes('디앤오보안'));
  if (!old) { console.log('  ⏭  이미 반영됨 — 건너뜀'); return; }
  await updateLabel(old.id, '비상연락 지시 : VIP 비서설 or 보안(동관 및 지하층 화재시)');
  console.log('  ✓ "디앤오보안" → "보안"');
}

// ── 2. 통제 ────────────────────────────────────────────
async function fixTongje() {
  console.log('\n[통제] 문구 수정 + 신규 임무 추가');
  const { roleId, tasks } = await getRoleWithTasks('통제');

  const old = tasks.find(t => t.label === '화재 상황파악 & 자위소방대 출동 상황');
  if (old) {
    await updateLabel(old.id, '화재 상황파악 & 자위소방대 출동');
    console.log('  ✓ "...출동 상황" → "...출동"');
  } else {
    console.log('  ⏭  문구 수정은 이미 반영됨');
  }

  const already = tasks.some(t => t.label === '주변 소화기,소화전을 이용하여 초기소화 지시');
  if (already) { console.log('  ⏭  신규 임무는 이미 존재 — 건너뜀'); return; }

  // 가스구역(variant) 블록 바로 뒤(현장확인... 앞)에 새 공통 임무 삽입 —
  // 뒤따르는 기존 임무들의 task_idx를 1씩 밀어서 자리 확보
  const gasEnd = Math.max(...tasks.filter(t => t.variant === '가스구역').map(t => t.task_idx));
  const toShift = tasks.filter(t => t.task_idx > gasEnd).sort((a, b) => b.task_idx - a.task_idx);
  for (const t of toShift) {
    const { error } = await supabase.from('disaster_tasks').update({ task_idx: t.task_idx + 1 }).eq('id', t.id);
    if (error) throw error;
  }
  await insertRows(roleId, [{ task_idx: gasEnd + 1, label: '주변 소화기,소화전을 이용하여 초기소화 지시', variant: null }]);
  console.log(`  ✓ 신규 임무 추가, 기존 ${toShift.length}건 뒤로 밀림`);
}

// ── 3. 상황 ────────────────────────────────────────────
async function fixSanghwang() {
  console.log('\n[상황] 빠진 임무 10건 추가');
  const { roleId, tasks } = await getRoleWithTasks('상황');

  // ① ◇1분이내 하위: "Ch1,2 무전기..." 다음에 2줄 삽입
  const marker1 = tasks.find(t => t.label === '┖ Ch1,2 무전기로 보안·시설파트·주차 상황전파 출동요청');
  const already1 = tasks.some(t => t.label === '┖ 상황실 BMS 및 1층 보안근무자 현장출동');
  if (marker1 && !already1) {
    const toShift = tasks.filter(t => t.task_idx > marker1.task_idx).sort((a, b) => b.task_idx - a.task_idx);
    for (const t of toShift) {
      const { error } = await supabase.from('disaster_tasks').update({ task_idx: t.task_idx + 2 }).eq('id', t.id);
      if (error) throw error;
    }
    await insertRows(roleId, [
      { task_idx: marker1.task_idx + 1, label: '┖ 상황실 BMS 및 1층 보안근무자 현장출동', variant: null },
      { task_idx: marker1.task_idx + 2, label: '┖ 야간) 전기근무자 현장출동, 운전근무자 상황실 이동', variant: null },
    ]);
    console.log('  ✓ ◇1분이내 하위 2건 추가');
  } else {
    console.log('  ⏭  ◇1분이내 하위 2건은 이미 존재 — 건너뜀');
  }

  // ② "문자보고 프로세서..." 다음, "◇ 화재시 설비 연동" 앞에 8줄(표준 헤더 없는 공통 블록) 삽입
  const { tasks: freshTasks } = await getRoleWithTasks('상황');
  const marker2 = freshTasks.find(t => t.label === '┖ 문자보고 프로세서 (BMS Phone 010-7716-8449)');
  const already2 = freshTasks.some(t => t.label === '화재접수 및 화재상황 파악');
  if (marker2 && !already2) {
    const newBlock = [
      '화재접수 및 화재상황 파악',
      '초기·자위소방대 비상연락망 가동 (ch1·2 무전기 전파)',
      '정보전달 : 화재 위치·종류등 카톡방 공지',
      '총괄자·소방안전관리자 직접전화 보고',
      '119 신고 : 총괄자 or 통제자 승인 후',
      '입주사등 관계자 비상문자 발송 : 총괄자 승인 후',
      '시간대별 화재,피난,구조구급등 현황판 기록',
      '기타 세부사항은 상황실 RNR 참조',
    ];
    const toShift = freshTasks.filter(t => t.task_idx > marker2.task_idx).sort((a, b) => b.task_idx - a.task_idx);
    for (const t of toShift) {
      const { error } = await supabase.from('disaster_tasks').update({ task_idx: t.task_idx + newBlock.length }).eq('id', t.id);
      if (error) throw error;
    }
    await insertRows(roleId, newBlock.map((label, i) => ({ task_idx: marker2.task_idx + 1 + i, label, variant: null })));
    console.log(`  ✓ 신규 공통 블록 ${newBlock.length}건 추가`);
  } else {
    console.log('  ⏭  신규 공통 블록은 이미 존재 — 건너뜀');
  }
}

// ── 4. 출동: 가스구역을 PDF의 5줄짜리 버전으로 교체 (기존 8줄 상세판 삭제) ─────
async function fixChuldong() {
  console.log('\n[출동] 가스구역을 통제와 동일한 5줄 버전으로 교체');
  const { roleId, tasks } = await getRoleWithTasks('출동');
  const target = [
    '방호구역 약제방출상태 확인',
    '미방출시 현장진입 > 화재여부 확인 > 화재시 소화기 초기소화',
    '방출시 진입금지 > 상황실 방출시간 확인 > 10분 후 진입',
    '환기 및 소화조 방화복 및 공기호흡기 착용 후 진입',
    '소방관도착시 소방관 진입',
  ];
  const current = tasks.filter(t => t.variant === '가스구역');
  const alreadyMatches = current.length === target.length && current.every(t => target.includes(t.label));
  if (alreadyMatches) { console.log('  ⏭  이미 최신 상태 — 건너뜀'); return; }

  if (current.length > 0) {
    await deleteIds(current.map(t => t.id));
    console.log(`  · 기존 가스구역 ${current.length}건 삭제`);
  }
  const { tasks: fresh } = await getRoleWithTasks('출동');
  const maxIdx = Math.max(...fresh.map(t => t.task_idx));
  await insertRows(roleId, target.map((label, i) => ({ task_idx: maxIdx + 1 + i, label, variant: '가스구역' })));
  console.log(`  ✓ 신규 5줄 추가`);
}

async function run() {
  await fixChonggwal();
  await fixTongje();
  await fixSanghwang();
  await fixChuldong();
  console.log('\n완료! twin-alarm 다음 화재 발령 시 반영됩니다.\n');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
