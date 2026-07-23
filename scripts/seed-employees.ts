/**
 * 직원 명부 시드 스크립트 (employees 테이블만 — 재난 배지는 더 이상 여기서 다루지 않음)
 * 실행: npm run seed-employees
 *
 * 작업 순서:
 *  1. Supabase SQL Editor 에서 supabase_schema.sql 의 employees 테이블 생성
 *  2. EMPLOYEES 배열에 실제 직원 데이터 입력
 *  3. npm run seed-employees 실행
 *  4. 재난 배지는 twin-alarm AdminPanel의 "재난 편제표" 탭에서 직접 배정
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env 로드 ──────────────────────────────────────────────
const envPath = resolve(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const eq = line.indexOf('=');
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'] || env['VITE_SUPABASE_ANON_KEY'];
if (!env['SUPABASE_SERVICE_ROLE_KEY']) {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY 미설정 — anon key 사용 (RLS 활성화 시 쓰기 실패 가능)');
}
const supabase = createClient(env['VITE_SUPABASE_URL'], supabaseKey);

// ── 재난 목록 ──────────────────────────────────────────────
const DISASTERS = ['화재', '정전', '누수', '태풍/홍수', '폭설', '지진', '가스누출', '승강기', '테러'] as const;
type Disaster = typeof DISASTERS[number];

// 2026-07-05: 팀→배지 자동매핑(TEAM_BADGE_MAP)은 폐지됨 — twin-alarm AdminPanel의
// "재난 편제표" 탭에서 배지별로 인원을 직접 배정/해제하는 방식으로 전환.

// ── 직원 데이터 ──────────────────────────────────────────
// 교대 직원은 본 파트와 동일한 team 으로 처리 (배지 동일)
// 보안파트는 화재시 역할에 따라 보안1/보안2/보안3 으로 구분 필요
//
// dept_code / shift_group : duty_matrix(재난 임무 매트릭스, 2026-07-03 PDF) 연동용 필드.
//   dept_code   duty_matrix.dept_code 와 매칭되는 부서 코드. team보다 세분화(건축사무→건축2,
//               건축현장→건축1 등)되며, 교대 상황실 인원은 하위 전문분야 기준 야OO 코드를 씀.
//               ※ 보안3 은 PDF 매트릭스에 아직 정의가 없어 team 값을 그대로 씀(추후 확정 필요).
//               ※ 건축파트장의 '건축2'는 건축사무(유도조)와 동일하게 취급한 추정치(구 TEAM_BADGE_MAP
//                 기준 — 화재 시 유도 배지 공유). PDF에 파트장 전용 행이 없어 확정은 아님.
//   shift_group role 텍스트의 "(A조·...)" 패턴을 정식 컬럼화. 상시주간 근무자는 undefined.
const EMPLOYEES: {
  emp_no: string;
  name: string;
  team: string;
  role: string;
  is_commander: boolean;
  email?: string;
  phone?: string;
  dept_code?: string;
  shift_group?: 'A' | 'B' | 'C' | 'D';
}[] = [
  // ── 센터장 / 상황실 ────────────────────────────────────
  { emp_no: 'E-0001', name: '김기창', team: '센터장',  role: '센터장', is_commander: true, email: 'xgplus@sni.co.kr',  phone: '010-3240-8177', dept_code: '총괄' },
  { emp_no: 'E-0002', name: '상황실', team: '상황실',  role: '상황실', is_commander: true, email: 'fire@sni.co.kr',    phone: '02-3773-1119',  dept_code: '상황' },

  // ── 운영 (2026-07-23: 곽우람 퇴사로 박세훈이 파트장 승계) ─────
  { emp_no: 'E-1002', name: '엄성철', team: '운영파트',   role: '파트원',      is_commander: false, email: 'sceom@sni.co.kr',    phone: '010-3384-0248', dept_code: '운영' },
  { emp_no: 'E-1003', name: '박세훈', team: '운영파트장', role: '파트장',      is_commander: true,  email: 'sehunpark@sni.co.kr',phone: '010-4776-7305', dept_code: '운영' },
  { emp_no: 'E-1004', name: '김기복', team: '운영파트',   role: '파트원',      is_commander: false, email: 'Igmbkkb@sni.co.kr',  phone: '010-5682-8498', dept_code: '운영' },
  { emp_no: 'E-1005', name: '김기환', team: '운영파트',   role: '파트원',      is_commander: false, email: 'kgh90400@sni.co.kr', phone: '010-8593-9040', dept_code: '운영' },

  // ── 기계 (교대 포함, 배지 동일) ───────────────────────
  { emp_no: 'E-2001', name: '손남열', team: '기계파트장', role: '파트장',      is_commander: false, email: 'k43414268@sni.co.kr',phone: '010-4341-4268', dept_code: '기계' },
  { emp_no: 'E-2002', name: '이영민', team: '기계파트',   role: '파트원',      is_commander: false, email: 'dldudzh@sni.co.kr',  phone: '010-8003-6154', dept_code: '기계' },
  { emp_no: 'E-2003', name: '이한승', team: '기계파트',   role: '파트원',      is_commander: false, email: 'lgmblhs2@sni.co.kr', phone: '010-7722-1247', dept_code: '기계' },
  { emp_no: 'E-2004', name: '홍진표', team: '기계파트',   role: '파트원',      is_commander: false, email: 'hjpas1@sni.co.kr',   phone: '010-5157-2185', dept_code: '기계' },
  { emp_no: 'E-2005', name: '장태선', team: '기계파트',   role: '파트원',      is_commander: false, email: 'zelgadis7391@sni.co.kr',phone: '010-6324-9939', dept_code: '기계' },
  { emp_no: 'E-2006', name: '박동선', team: '기계파트',   role: '파트원',      is_commander: false, email: 'P93071077@sni.co.kr', phone: '010-9258-8010', dept_code: '기계' },
  { emp_no: 'E-2007', name: '김범재', team: '상황실',     role: '교대원(A조·운전)', is_commander: false, email: 'sneeze@sni.co.kr',   phone: '010-9016-0123', dept_code: '야운전', shift_group: 'A' },
  { emp_no: 'E-2008', name: '윤창현', team: '상황실',     role: '교대원(B조·운전)', is_commander: false, email: 'bulpaesino@sni.co.kr',phone: '010-6794-2700', dept_code: '야운전', shift_group: 'B' },
  { emp_no: 'E-2009', name: '김성',   team: '상황실',     role: '교대원(C조·운전)', is_commander: false, email: 'gobani@sni.co.kr',   phone: '010-8967-6164', dept_code: '야운전', shift_group: 'C' },
  { emp_no: 'E-2010', name: '유지원', team: '상황실',     role: '교대원(D조·운전)', is_commander: false, email: 'ues2967@sni.co.kr',  phone: '010-5687-2967', dept_code: '야운전', shift_group: 'D' },
  { emp_no: 'E-2011', name: '강석중', team: '상황실',     role: '교대조장(A조·BMS)', is_commander: false, email: 'kangsj72@sni.co.kr', phone: '010-7645-3388', dept_code: '야BMS', shift_group: 'A' },
  { emp_no: 'E-2012', name: '석경민', team: '상황실',     role: '교대조장(B조·BMS)', is_commander: false, email: 'csq3309@sni.co.kr',  phone: '010-9498-8201', dept_code: '야BMS', shift_group: 'B' },
  { emp_no: 'E-2013', name: '손경배', team: '상황실',     role: '교대원(D조·BMS)',  is_commander: false, email: 'sonkb@sni.co.kr',    phone: '010-2707-4712', dept_code: '야BMS', shift_group: 'D' },
  { emp_no: 'E-2014', name: '김예찬', team: '상황실',     role: '교대원(C조·BMS)',  is_commander: false, email: 'zkzldhgk@sni.co.kr', phone: '010-5443-8917', dept_code: '야BMS', shift_group: 'C' },

  // ── 전기 (교대 포함, 배지 동일) ───────────────────────
  { emp_no: 'E-3001', name: '이길호', team: '전기파트장', role: '파트장',      is_commander: false, email: 'kannylord@sni.co.kr', phone: '010-5654-0564', dept_code: '전기' },
  { emp_no: 'E-3002', name: '장현철', team: '전기파트',   role: '파트원',      is_commander: false, email: 'jhc1006@sni.co.kr',   phone: '010-5595-8285', dept_code: '전기' },
  { emp_no: 'E-3003', name: '김태경', team: '전기파트',   role: '파트원',      is_commander: false, email: 'kimgyuchol@sni.co.kr',phone: '010-4211-8049', dept_code: '전기' },
  { emp_no: 'E-3004', name: '이환수', team: '전기파트',   role: '파트원',      is_commander: false, email: 'Ihs0318@sni.co.kr',   phone: '010-3387-8910', dept_code: '전기' },
  { emp_no: 'E-3005', name: '김상훈', team: '전기파트',   role: '파트원',      is_commander: false, email: 'guswlr4@sni.co.kr',   phone: '010-5046-1866', dept_code: '전기' },
  { emp_no: 'E-3006', name: '김현직', team: '전기파트',   role: '파트원',      is_commander: false, email: 'ksh1866@sni.co.kr',   phone: '010-2328-2474', dept_code: '전기' },
  { emp_no: 'E-3007', name: '이찬희', team: '전기파트',   role: '파트원(교대)',is_commander: false, email: 'chunww1@sni.co.kr',   phone: '010-4809-5710', dept_code: '야전기' },
  { emp_no: 'E-3008', name: '심현보', team: '상황실',     role: '교대원(A조·전기)', is_commander: false, email: 'shb4561@sni.co.kr',   phone: '010-4004-4561', dept_code: '야전기', shift_group: 'A' },
  { emp_no: 'E-3009', name: '김성환', team: '상황실',     role: '교대원(B조·전기)', is_commander: false, email: 'manager100@sni.co.kr',phone: '010-4141-8945', dept_code: '야전기', shift_group: 'B' },
  { emp_no: 'E-3010', name: '이태경', team: '상황실',     role: '교대원(C조·전기)', is_commander: false, email: 'leetae8171@sni.co.kr',phone: '010-6255-8171', dept_code: '야전기', shift_group: 'C' },

  // ── 소방 (교대 포함, 배지 동일) ───────────────────────
  { emp_no: 'E-4001', name: '김견수', team: '소방파트장', role: '파트장(안전관리자)', is_commander: true,  email: 'kyensu_kim@sni.co.kr',phone: '010-9071-3061', dept_code: '소방' },
  { emp_no: 'E-4002', name: '송치선', team: '소방파트',   role: '파트원',      is_commander: false, email: 'song5059@sni.co.kr',  phone: '010-4659-5059', dept_code: '소방' },
  { emp_no: 'E-4003', name: '이동건', team: '소방파트',   role: '파트원',      is_commander: false, email: 'DongKun_Lee@sni.co.kr',phone: '010-2575-2806', dept_code: '소방' },
  { emp_no: 'E-4004', name: '정민석', team: '소방파트',   role: '파트원',      is_commander: false, email: 'mins_jeong@sni.co.kr',phone: '010-8752-8967', dept_code: '소방' },
  { emp_no: 'E-4005', name: '안준혁', team: '상황실',     role: '교대조장(C조·방재)', is_commander: true,  email: 'AJH90@sni.co.kr',     phone: '010-3449-3784', dept_code: '야소방', shift_group: 'C' },
  { emp_no: 'E-4006', name: '김병기', team: '상황실',     role: '교대조장(D조·방재)', is_commander: true,  email: 'KBG82@sni.co.kr',     phone: '010-9248-3016', dept_code: '야소방', shift_group: 'D' },
  { emp_no: 'E-4007', name: '박범수', team: '상황실',     role: '교대원(B조·방재)',   is_commander: true,  email: 'Pray_bs@sni.co.kr',   phone: '010-9437-1985', dept_code: '야소방', shift_group: 'B' },
  { emp_no: 'E-4008', name: '김상백', team: '상황실',     role: '교대원(A조·방재)',   is_commander: true,  email: 'ksb408@sni.co.kr',    phone: '010-2503-7305', dept_code: '야소방', shift_group: 'A' },

  // ── 건축 — 파트장 ─────────────────────────────────────
  { emp_no: 'E-5001', name: '이수용', team: '건축파트장', role: '파트장',      is_commander: false, email: 'suyong@sni.co.kr',       phone: '010-2966-0477', dept_code: '건축2' },
  // ── 건축사무 (유도조) ──────────────────────────────────
  { emp_no: 'E-5002', name: '최낙철', team: '건축사무',   role: '파트원',      is_commander: false, email: 'narkcholchoi@sni.co.kr', phone: '010-9229-4949', dept_code: '건축2' },
  { emp_no: 'E-5003', name: '염혜진', team: '건축사무',   role: '파트원',      is_commander: false, email: 'hejing@sni.co.kr',       phone: '010-6305-1131', dept_code: '건축2' },
  { emp_no: 'E-5004', name: '김규영', team: '건축사무',   role: '파트원',      is_commander: false, email: 'xgplus@sni.co.kr',       phone: '010-7514-9713', dept_code: '건축2' },
  { emp_no: 'E-5005', name: '최인규', team: '건축사무',   role: '파트원',      is_commander: false, email: 'inkyutj@sni.co.kr',      phone: '010-7130-5219', dept_code: '건축2' },
  { emp_no: 'E-5009', name: '윤희진', team: '건축사무',   role: '파트원',      is_commander: false, email: 'yhjyhj@sni.co.kr',       phone: '010-7180-6471', dept_code: '건축2' },
  // ── 건축현장 (방호조) ──────────────────────────────────
  { emp_no: 'E-5006', name: '서영진', team: '건축현장',   role: '파트원',      is_commander: false, email: 'syjin19@sni.co.kr',      phone: '010-3633-7850', dept_code: '건축1' },
  { emp_no: 'E-5007', name: '김정훈', team: '건축현장',   role: '파트원',      is_commander: false, email: 'kjhsj0707@sni.co.kr',    phone: '010-3936-2530', dept_code: '건축1' },
  { emp_no: 'E-5008', name: '박진범', team: '건축현장',   role: '파트원',      is_commander: false, email: 'rkausantk@sni.co.kr',    phone: '010-5954-4893', dept_code: '건축1' },

  // ── 품질/안전 ──────────────────────────────────────────
  { emp_no: 'E-6001', name: '안상오', team: '품질/안전파트', role: '파트장',   is_commander: false, email: 'ASO82@sni.co.kr',     phone: '010-7557-3009', dept_code: '안전' },
  { emp_no: 'E-6002', name: '김홍신', team: '품질/안전파트', role: '파트원',   is_commander: false, email: 'wlsqja846@sni.co.kr', phone: '010-8596-8299', dept_code: '안전' },
  { emp_no: 'E-6003', name: '반충기', team: '품질/안전파트', role: '파트원',   is_commander: false, phone: '010-9258-3411', dept_code: '안전' },
  { emp_no: 'E-6004', name: '장용현', team: '품질/안전파트', role: '파트원',   is_commander: false, phone: '010-9258-3411', dept_code: '안전' },

  // ── 보안 (화재시 보안1/2/3 구분) ─────────────────────
  { emp_no: 'E-7001', name: '김우현', team: '보안1', role: '파트원', is_commander: false, email: 'kwh12@snipartner.co.kr',             phone: '010-9396-7173', dept_code: '보안1' },
  { emp_no: 'E-7002', name: '김정수', team: '보안2', role: '파트원', is_commander: false, email: 'agito2001@snipartner.co.kr',         phone: '010-9201-0039', dept_code: '보안2' },
  { emp_no: 'E-7003', name: '김병찬', team: '보안2', role: '파트원', is_commander: false, email: 'greenday@snipartner.co.kr',          phone: '010-7750-9488', dept_code: '보안2' },
  { emp_no: 'E-7004', name: '길성용', team: '보안3', role: '파트원', is_commander: false, email: 'ksy84@snipartner.co.kr',             phone: '010-7199-5276', dept_code: '보안3' },
  { emp_no: 'E-7005', name: '김성진', team: '보안3', role: '파트원', is_commander: false, email: 'sungjin1116.kim@lgepartner.com',     phone: '010-6579-1116', dept_code: '보안3' },
  { emp_no: 'E-7006', name: '문상균', team: '보안3', role: '파트원', is_commander: false, email: 'sanggyun.moon@snipartner.co.kr',     phone: '010-6625-2621', dept_code: '보안3' },
  { emp_no: 'E-7007', name: '이상혁', team: '보안1', role: '파트원', is_commander: false, email: 'kwh13@snipartner.co.kr',             phone: '010-7266-1229', dept_code: '보안1' },
  { emp_no: 'E-7008', name: '정충진', team: '보안1', role: '파트원', is_commander: false, email: 'kwh22@snipartner.co.kr',             phone: '010-8236-8292', dept_code: '보안1' },
  { emp_no: 'E-7009', name: '김승빈', team: '보안1', role: '파트원', is_commander: false, email: 'kwh23@snipartner.co.kr',             phone: '010-2344-2169', dept_code: '보안1' },
  { emp_no: 'E-7010', name: '김성훈', team: '보안2', role: '파트원(주간)', is_commander: false, phone: '010-4063-2111', dept_code: '보안2' },
  { emp_no: 'E-7011', name: '박현우', team: '보안2', role: '파트원(주간)', is_commander: false, phone: '010-7604-6406', dept_code: '보안2' },
  { emp_no: 'E-7012', name: '조현영', team: '보안2', role: '파트원(야간)', is_commander: false, phone: '010-4537-7453', dept_code: '보안2' },
  { emp_no: 'E-7013', name: '성민규', team: '보안2', role: '파트원(야간)', is_commander: false, phone: '010-4195-6824', dept_code: '보안2' },
  { emp_no: 'E-7014', name: '김금천', team: '보안2', role: '파트원(야간)', is_commander: false, phone: '010-2543-9844', dept_code: '보안2' },
  { emp_no: 'E-7015', name: '임수민', team: '보안2', role: '파트원(야간)', is_commander: false, phone: '010-5204-9219', dept_code: '보안2' },

  // ── 주차 ───────────────────────────────────────────────
  { emp_no: 'E-9001', name: '김재석', team: '주차파트', role: '파트원', is_commander: false, email: 'ooollpp@snipartner.co.kr',        phone: '010-5618-3369', dept_code: '주차' },
  { emp_no: 'E-9002', name: '최민서', team: '주차파트', role: '파트원(주간)', is_commander: false, phone: '010-4422-2196', dept_code: '주차' },
  { emp_no: 'E-9003', name: '최은식', team: '주차파트', role: '파트원(야간)', is_commander: false, phone: '010-3132-2881', dept_code: '주차' },
  { emp_no: 'E-9004', name: '정양진', team: '주차파트', role: '파트원(야간)', is_commander: false, phone: '010-2205-8892', dept_code: '주차' },

  // ── 미화 ───────────────────────────────────────────────
  { emp_no: 'E-8001', name: '지정운', team: '미화파트', role: '파트원', is_commander: false, email: 'jjw082300@snipartner.co.kr',      phone: '010-3653-1016', dept_code: '미화' },

  // ── 상황실 교대 공석 (채용 예정) ─────────────────────────
  // D조 전기 근무자 — 채용 후 emp_no/name 추가
  // { emp_no: 'SS-D03', name: '채용예정', team: '상황실', role: '교대원(D조)', is_commander: false, dept_code: '야전기', shift_group: 'D' },
];

// ── 시드 실행 ──────────────────────────────────────────────
// 2026-07-05: 예전엔 여기서 badge '상황실'/'상황실/화재'라는 별도 disaster_roles 행을 생성했으나,
// 그 임무 내용을 disa_app이 관리하는 각 재난의 일반 '상황' 역할에 병합했으므로 제거함
// (TEAM_BADGE_MAP의 '상황실' 팀 배지도 '상황'으로 통일).
async function seed() {
  console.log(`\n직원 시드 시작 (${EMPLOYEES.length}명)...\n`);

  // SS-* 중복 항목 삭제 (이전 seed에서 잘못 생성된 항목 정리)
  const { error: delBadgeErr } = await supabase.from('employee_disaster_badges').delete().like('emp_no', 'SS-%');
  if (delBadgeErr) console.error('  ✗ SS-* 배지 삭제 오류:', delBadgeErr.message);
  else console.log('  🗑 SS-* 배지 항목 삭제 완료');
  const { error: delEmpErr } = await supabase.from('employees').delete().like('emp_no', 'SS-%');
  if (delEmpErr) console.error('  ✗ SS-* 직원 삭제 오류:', delEmpErr.message);
  else console.log('  🗑 SS-* 직원 항목 삭제 완료\n');

  // 2026-07-05: employee_disaster_badges는 더 이상 이 스크립트가 건드리지 않음 — twin-alarm
  // AdminPanel의 "재난 편제표" 탭에서 배지별로 인원을 직접 배정/해제하는 방식으로 전환했음.
  // (재실행 시 TEAM_BADGE_MAP 기준으로 되돌려 수동 배정을 덮어쓰는 걸 방지)
  for (const emp of EMPLOYEES) {
    const { error: empErr } = await supabase
      .from('employees')
      .upsert(emp, { onConflict: 'emp_no' });
    if (empErr) { console.error(`  ✗ ${emp.name} 직원 오류:`, empErr.message); continue; }
    console.log(`  ✓ ${emp.name} (${emp.team})`);
  }

  console.log('\n직원 시드 완료!');
}

seed().catch(console.error);
