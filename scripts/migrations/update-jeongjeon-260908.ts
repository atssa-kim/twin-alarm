/**
 * 정전 주/야간 임무 갱신 (2026-09-08)
 * 실행: npx tsx scripts/migrations/update-jeongjeon-260908.ts
 *
 * 원본: 사용자 제공 "비상대응임무_정전.xlsx" (정전 / 정전_야간 시트)
 *
 * 하는 일:
 *   1. 주간 총괄·상황·통제·대응(전기) 임무 텍스트를 엑셀 내용으로 전체 교체
 *   2. 주간 대응 배지를 부서별로 분리: 대응(전기, 유지) / 대응1(기계, 신설) / 대응2(소방, 신설)
 *   3. 주간 지원 배지를 부서별로 분리: 지원1(보안, 신설) / 지원2(주차, 신설). 기존 '지원'(운영+보안
 *      혼합) 역할은 폐기 — 엑셀에 운영 임무가 없음.
 *   4. 주간 employee_disaster_badges 재배정: 기계파트→대응1, 보안→지원1, 주차(기존 '유도')→지원2.
 *      건축·미화·운영 담당자는 정전 배지 제거(엑셀에 해당 부서 임무가 없다는 지시에 따름).
 *   5. 정전 야간 역할이 DB에 전혀 없었으므로 상황/통제/대응2(기계)/대응3(소방)/지원1(보안)/지원2(주차)
 *      6개 역할·임무를 신규 생성. 인원 배정은 보류(추후 AdminPanel 재난 편제표에서 수동 배정).
 *
 * 상황실(id=812) 배지/임무는 이번 엑셀과 무관(범용 템플릿)하여 건드리지 않음.
 *
 * 재실행해도 안전(idempotent) — 역할이 이미 있으면 임무만 갱신하고 건너뜁니다.
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

// ── 임무 텍스트 (엑셀 그대로) ────────────────────────────────
const TASKS = {
  총괄: [
    '정전 초기 상황 파악(전화·무전·카톡)',
    '정전 상황 및 1차 피해 현황(한전 정전 여부, 승강기 갇힘, 에스컬레이터 전도 사고) 확인',
    '상황실 1차 보고 받고 상급자, 고객사 1차 보고(원인 및 1차 피해상황)',
    '마포 종합상황실 신고 여부 검토 (☎ 1661-8182)',
    '상황실 이동-지휘 및 통제',
    '상황실 2차 보고 받고 상급자, 고객사 2차 보고(복구가능시간 및 2차 피해상황)',
    '복구 및 대책수립(피해 발생시 - 본사대응 요청등 대책수립)',
    '종료보고_상급자 및 고객사',
  ],
  상황: [
    '정전 상황 접수 후 조별 출동 지시 (전화·무전·카톡)',
    '승강기 갇힘 사고 유무, 에스컬레이터 전도 사고 유무 파악',
    '비상발전기 가동 여부 확인',
    '정전 상황 및 1차 피해 현황(한전 정전 여부, 승강기 갇힘, 에스컬레이터 전도 사고) 총괄관리자 1차 보고',
    '◇승강기 갇힘 사고 발생 시',
    '┖ 지원반 소방조 오티스 상주 직원 출동 요청 및 갇힘 승객 심리케어, 구출 후 보고',
    '┖ 갇힘 호기, 갇힘 층, 갇힘 인원 파악',
    '┖ 갇힘 호기 별 오티스 출동 시간, 구출 시간, 갇힘 시간, 갇힘 인원, 인적사항 파악',
    '◇에스컬레이터 전도 사고 발생 시',
    '┖ 지원반 소방조 전도 사고 피해 인원, 인적사항 파악 보고',
    '◇전체 정전 시',
    '┖ 지원반 소방조 비상방송 송출(정전)',
    '마포 종합상황실 신고 여부 총괄관리자 확인 (☎ 1661-8182)',
    '◇마포 종합상황실 신고 확정 시',
    '┖ 상황실 조장 마포 종합상황실 최초 신고',
    '전기, 기계, 소방 주요설비 이상 유무 접수 및 취합',
    '운영(주차정산, 스피드게이트) 가동 유무 접수 및 취합',
    '시설 및 운영 전체 피해 현황 취합 후 총괄관리자 2차 보고',
    '총괄관리자 정전 조치 상황 수시 보고',
    '복전 후 전기, 기계, 소방, 자동제어, 주차정산, 스피드게이트 등 설비 이상유무 확인 지시(전화·무전·카톡)',
    '◇전체 복전 시',
    '┖ 지원반 소방조 비상방송 송출(복전)',
    '◇마포 종합상황실 신고한 경우',
    '┖ 상황실 조장 마포 종합상황실 최종 보고 (☎ 1661-8182)',
  ],
  통제: [
    '각 수변전실 이동, 정전 범위(한전/구내) 파악 지시(전화·무전·카톡)',
    'UPS 이상유무 파악 지시(전화·무전·카톡)',
    '◇승강기 갇힘 사고 발생 시',
    '┖ 승강기 갇힘 호기, 갇힘 층, 갇힘 인원 보고 받고 진행상황 체크',
    '┖ 구출 예상 시간 및 진행상황 보고받고 총괄관리자(센터장) 보고',
    '◇에스컬레이터 전도 사고 발생 시',
    '┖ 에스컬레이터 전도 사고 내용 보고 받고 진행상황 체크',
    '┖ 피해자 피해 여부 파악하여 총괄관리자(센터장) 보고',
    '◇전체 정전 시',
    '┖ 대응조 비상발전기 가동 여부 확인 지시(전화·무전·카톡)',
    '┖ 대응조 각 ATS반 이동하여 ATS 절체 상태 확인 지시(전화·무전·카톡)',
    '┖ 대응조 각 수변전실 이동 분기 VCB 차단 지시',
    '◇구내 전기설비 소손 시',
    '┖ 업체 수배하여 긴급 복구 실시(임시 조치 가능 시 운영센터 자체 조치)',
    '피해 범위 파악 후 복구 우선순위 결정',
    '피해 범위, 복구 우선순위, 복구 예상시간 상황실, 총괄관리자 보고(전화·무전·카톡)',
    '◇전체 정전 후 복전 시',
    '┖ 통제자(전기파트장) 지하1층 수전실 이동',
    '┖ 통제자(전기파트장) 계전기 RESET 및 메인 VCB 투입',
    '┖ 대응조 분기 VCB 투입 지시',
    '전체 수변전실 복전 상태 확인 지시(전화·무전·카톡)',
    'ATS 절체 복구 상태 확인 지시(전화·무전·카톡)',
    '비상발전기 정지 여부 확인 지시(전화·무전·카톡)',
    '복전 후 UPS 이상유무 파악 지시(전화·무전·카톡)',
    '전체 전기시설물 이상유무 파악 보고 받고 최종 피해 총괄관리자 최종 보고',
    '원인 분석 및 재발방지 대책 수립',
  ],
  대응_전기: [
    '각 수변전실 이동하여 정전 범위(한전/구내) 파악',
    '◇승강기 갇힘 사고 발생 시 (장현철,김태경,이환수)',
    '┖ 승강기 갇힘 호기, 갇힘 층, 갇힘 인원 파악 후 OTIS와 같이 구출',
    '┖ 구출 예상 시간 및 진행상황 파악 후 통제자(전기파트장) 보고',
    '◇에스컬레이터 전도 사고 발생 시',
    '┖ 에스컬레이터 전도 사고 내용 파악 후 피해 여부 확인',
    '┖ 피해자 피해 여부 파악하여 통제자(전기파트장) 보고',
    '┖ 비상발전기 가동 여부 확인 후 상황실 및 통제자(전기파트장) 보고(전화·무전·카톡)',
    '┖ 발전기실 이동 비상발전기 가동 상태 확인 및 모니터링',
    '┖ 각 ATS반 이동하여 ATS 절체 상태 확인 후 상황실 및 통제자(전기파트장) 보고(전화·무전·카톡)',
    '┖ 각 수변전실 이동 분기 VCB 차단 후 통제자(전기파트장) 보고',
    '◇구내 전기설비 소손 시',
    '┖ 업체 수배하여 긴급 복구 실시(임시 조치 가능 시 운영센터 자체 조치)',
    '◇한전 정전(순간정전) 시',
    '┖ 정전 원인 및 복구 예정 시간 문의(한전 변전소) 후 상황실 및 통제자(전기파트장) 보고',
    '전기 시설물 및 수변전설비 이상유무 파악 후 상황실 및 통제자(전기파트장) 보고',
    '◇전체 정전 후 복전 시',
    '┖ 대응조 각 수변실로 이동하여 통제자(전기파트장) 지시에 따라 분기 VCB 투입(ON)',
    '┖ 대응조 비상발전기 정지 여부 확인 후 상황실 및 통제자(전기파트장) 보고(전화·무전·카톡)',
    '┖ 각 ATS반 이동하여 ATS 절체 상태 확인 후 상황실 및 통제자(전기파트장) 보고(전화·무전·카톡)',
    'UPS 이상유무 파악 후 통제자(전기파트장) 보고',
    '전체 전기시설물 이상유무 파악 후 상황실 및 통제자(전기파트장) 보고',
    '각 수변전실 이동하여 정전 범위(한전/구내) 파악',
    '각 UPS실 이동하여 UPS 이상유무 파악',
  ],
  대응_기계: [
    '중앙 지하3층 냉동기실 이동 냉동기 가동 상태 확인',
    '중앙 지하3층 보일러실 이동 보일러 가동 상태 확인',
    '중앙 지하3층 정화조 운전반실 이동 정화조 가동 상태 확인',
    '동관, 서관 옥탑 냉각탑 및 스크롤냉동기 가동 상태 확인',
    '복전 후 중앙 지하3층 냉동기실 이동 냉동기 재가동',
    '복전 후 중앙 지하3층 보일러실 이동 보일러 재가동',
    '복전 후 중앙 지하3층 정화조 운전반실 이동 정화조 가동 상태 확인',
    '복전 후 동관, 서관 옥탑 냉각탑 및 스크롤냉동기 가동 상태 확인 및 동작',
    '복전 후 자동제어 서버 및 공조기 가동상태 확인 및 이상 시 현장 출동 리셋 조치',
    '복전 후 냉온수기, 항온항습기, AHU 가동 유무 확인 및 이상 시 현장 출동 리셋 조치',
  ],
  대응_소방: [
    '상황실 내 수신기 등 소방설비 및 CCTV 이상 유무 확인,승강기 가동 상태 확인',
    '상황실 내 비상조명등 점등상태 확인 및 미점등시 현장확인',
    '현장 소화펌프,제연휀 동력제어반등 비상전원 투입상태 점검',
    '현장 수동조작함,방화셔터등 기타 소방설비 비상전원 투입상태 점검',
    '◇승강기 갇힘 사고 발생 시',
    '┖ 승강기 갇힘 호기, 갇힘 층, 갇힘 인원 파악 후 OTIS 상주 직원 출동 요청',
    '┖ 갇힘 승객 심리케어',
    '◇에스컬레이터 전도 사고 발생 시',
    '┖ 에스컬레이터 전도 사고 내용 파악 후 피해 여부 확인',
    '┖ 119 신고 필요 여부 확인하여 119 출동 요청',
    '◇전체 정전 시',
    '┖ 전체 정전 확인 시 비상방송 송출',
    '상황실 복전 후 수신기 등 소방설비 및 CCTV 이상 유무 확인',
    '상황실 내 비상조명등 점등상태 확인 및 미점등시 현장확인',
    '현장 소화펌프,제연휀 동력제어반등 상용전원 투입상태 점검',
    '현장 수동조작함,방화셔터등 기타 소방설비 상용전원 투입상태 점검',
  ],
  지원_보안: [
    '정전 시 동관, 서관 승강기 탑승 통제 및 비상계단 유도',
    '무전기로 현재 상황 상황실 지속 보고',
  ],
  지원_주차: [
    '정전으로 출차 불가 시 고객 안내 및 상황실 보고',
    '주차 차단기 바 수동 조작 및 입출차 수동 운영',
  ],
};

// ── 역할 정의: 주간(업데이트 대상은 existingId, 신설은 없음) + 신설 배지 ──
type RoleDef = {
  shift: 'day' | 'night';
  badge: string;
  group_name: string;
  role: string;
  bc: string;
  sort_order: number;
  existingId?: number;
  tasks: string[];
};

const ROLE_DEFS: RoleDef[] = [
  // ── 주간: 기존 역할 텍스트 갱신 ──
  { shift: 'day', badge: '총괄', group_name: '지휘', role: '🏢 총괄관리자 (센터장)', bc: '#451a03', sort_order: 10, existingId: 10, tasks: TASKS.총괄 },
  { shift: 'day', badge: '상황', group_name: '연락', role: '📻 상황실 (조장)', bc: '#78350f', sort_order: 20, existingId: 11, tasks: TASKS.상황 },
  { shift: 'day', badge: '통제', group_name: '대응반', role: '⚙️ 통제자 (전기파트장)', bc: '#92400e', sort_order: 30, existingId: 12, tasks: TASKS.통제 },
  { shift: 'day', badge: '대응', group_name: '대응반', role: '⚙️ 대응조 (전기파트)', bc: '#92400e', sort_order: 40, existingId: 13, tasks: TASKS.대응_전기 },

  // ── 주간: 신설 배지 ──
  { shift: 'day', badge: '대응1', group_name: '대응반', role: '🔧 대응1조 (기계파트)', bc: '#92400e', sort_order: 41, tasks: TASKS.대응_기계 },
  { shift: 'day', badge: '대응2', group_name: '대응반', role: '🚒 대응2조 (소방파트)', bc: '#92400e', sort_order: 42, tasks: TASKS.대응_소방 },
  { shift: 'day', badge: '지원1', group_name: '지원반', role: '🚶 지원1조 (보안파트)', bc: '#6b3a2a', sort_order: 50, tasks: TASKS.지원_보안 },
  { shift: 'day', badge: '지원2', group_name: '지원반', role: '🅿️ 지원2조 (주차파트)', bc: '#6b3a2a', sort_order: 51, tasks: TASKS.지원_주차 },

  // ── 야간: 전체 신설 ──
  // 주의: disaster_roles에 (disaster, badge) 레거시 유니크 인덱스가 남아 있어 shift가 달라도
  // 같은 disaster 안에서 배지명을 재사용할 수 없음(화재도 같은 이유로 night 배지에 "(야간)"을
  // 붙여 회피함 — 예: '통제(야간)', '유도1(야간)'). 그 관례를 따름.
  { shift: 'night', badge: '상황(야간)', group_name: '야간대응', role: '🌙 상황실 (조장)', bc: '#78350f', sort_order: 10, tasks: TASKS.상황 },
  { shift: 'night', badge: '통제(야간)', group_name: '야간대응', role: '🌙 통제자 (전기파트장)', bc: '#92400e', sort_order: 20, tasks: TASKS.통제 },
  { shift: 'night', badge: '대응2(야간)', group_name: '야간대응', role: '🌙 대응2조 (기계파트)', bc: '#92400e', sort_order: 30, tasks: TASKS.대응_기계 },
  { shift: 'night', badge: '대응3(야간)', group_name: '야간대응', role: '🌙 대응3조 (소방파트)', bc: '#92400e', sort_order: 40, tasks: TASKS.대응_소방 },
  { shift: 'night', badge: '지원1(야간)', group_name: '야간대응', role: '🌙 지원1조 (보안파트)', bc: '#6b3a2a', sort_order: 50, tasks: TASKS.지원_보안 },
  { shift: 'night', badge: '지원2(야간)', group_name: '야간대응', role: '🌙 지원2조 (주차파트)', bc: '#6b3a2a', sort_order: 60, tasks: TASKS.지원_주차 },
];

// 폐기 대상: 주간 '지원'(운영+보안 혼합) — 엑셀에서 지원1/지원2로 대체됨
const DEPRECATED_DAY_BADGES = ['지원'];

// ── employee_disaster_badges 재배정 ──
const MECH_TO_대응1 = ['E-2001', 'E-2002', 'E-2003', 'E-2004', 'E-2005', 'E-2006']; // 기계파트
const SECURITY_TO_지원1 = [
  'E-7001', 'E-7002', 'E-7003', 'E-7004', 'E-7005', 'E-7006', 'E-7007',
  'E-7008', 'E-7009', 'E-7010', 'E-7011', 'E-7012', 'E-7013', 'E-7014', 'E-7015',
]; // 보안1/2/3
const PARKING_TO_지원2_FROM_유도 = ['E-9001', 'E-9002', 'E-9003', 'E-9004']; // 주차파트
const NO_MISSION_REMOVE = [
  // 건축(사무·현장)
  'E-5001', 'E-5002', 'E-5003', 'E-5004', 'E-5005', 'E-5006', 'E-5007', 'E-5008', 'E-5009',
  // 미화
  'E-8001',
  // 운영
  'E-1002', 'E-1003', 'E-1004', 'E-1005', 'E1159826', 'E1226710',
];

async function upsertRole(def: RoleDef) {
  let roleId = def.existingId;
  if (roleId == null) {
    const { data: found, error: findErr } = await supabase
      .from('disaster_roles')
      .select('id')
      .eq('disaster', '정전')
      .eq('shift', def.shift)
      .eq('badge', def.badge)
      .maybeSingle();
    if (findErr) throw findErr;
    roleId = found?.id;
  }

  if (roleId == null) {
    const { data: inserted, error: insErr } = await supabase
      .from('disaster_roles')
      .insert({ disaster: '정전', shift: def.shift, badge: def.badge, group_name: def.group_name, role: def.role, bc: def.bc, sort_order: def.sort_order })
      .select('id')
      .single();
    if (insErr) throw insErr;
    roleId = inserted.id;
    console.log(`  + 신설: ${def.shift}/${def.badge} (role id=${roleId})`);
  } else {
    const { error: updErr } = await supabase
      .from('disaster_roles')
      .update({ group_name: def.group_name, role: def.role, bc: def.bc, sort_order: def.sort_order })
      .eq('id', roleId);
    if (updErr) throw updErr;
    console.log(`  ~ 갱신: ${def.shift}/${def.badge} (role id=${roleId})`);
  }

  const { error: delErr } = await supabase.from('disaster_tasks').delete().eq('role_id', roleId);
  if (delErr) throw delErr;
  const { error: taskErr } = await supabase
    .from('disaster_tasks')
    .insert(def.tasks.map((label, i) => ({ role_id: roleId, task_idx: i + 1, label })));
  if (taskErr) throw taskErr;
  console.log(`    임무 ${def.tasks.length}건 적재`);
}

async function dropDeprecatedRoles() {
  for (const badge of DEPRECATED_DAY_BADGES) {
    const { data, error } = await supabase
      .from('disaster_roles')
      .delete()
      .eq('disaster', '정전')
      .eq('shift', 'day')
      .eq('badge', badge)
      .select('id');
    if (error) throw error;
    if (data && data.length > 0) console.log(`  - 폐기: day/${badge} (role id=${data.map(d => d.id).join(',')}) — disaster_tasks는 CASCADE로 함께 삭제`);
  }
}

async function reassignEmployees() {
  const upd = async (empNos: string[], newBadge: string, fromBadge: string) => {
    if (empNos.length === 0) return;
    const { data, error } = await supabase
      .from('employee_disaster_badges')
      .update({ badge: newBadge })
      .eq('disaster', '정전')
      .eq('shift', 'day')
      .eq('badge', fromBadge)
      .in('emp_no', empNos)
      .select('emp_no');
    if (error) throw error;
    console.log(`  ~ ${fromBadge} → ${newBadge}: ${data?.length ?? 0}명`);
  };

  await upd(MECH_TO_대응1, '대응1', '대응');
  await upd(SECURITY_TO_지원1, '지원1', '지원');
  await upd(PARKING_TO_지원2_FROM_유도, '지원2', '유도');

  const { data: removed, error: rmErr } = await supabase
    .from('employee_disaster_badges')
    .delete()
    .eq('disaster', '정전')
    .eq('shift', 'day')
    .in('emp_no', NO_MISSION_REMOVE)
    .select('emp_no');
  if (rmErr) throw rmErr;
  console.log(`  - 임무 없음(건축·미화·운영) 배지 제거: ${removed?.length ?? 0}명`);
}

async function run() {
  console.log('정전 임무/배지 갱신 시작...\n');

  console.log('[1] 역할·임무 갱신/신설');
  for (const def of ROLE_DEFS) await upsertRole(def);

  console.log('\n[2] 폐기 배지 제거');
  await dropDeprecatedRoles();

  console.log('\n[3] 인원 재배정');
  await reassignEmployees();

  console.log('\n✅ 완료');
}

run().catch(err => { console.error('❌ 실패:', err); process.exit(1); });
