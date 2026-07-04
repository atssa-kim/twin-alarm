/**
 * 직원 명부 + 재난별 배지 시드 스크립트
 * 실행: npm run seed-employees
 *
 * 작업 순서:
 *  1. Supabase SQL Editor 에서 supabase_schema.sql 의 employees / employee_disaster_badges 테이블 생성
 *  2. EMPLOYEES 배열에 실제 직원 데이터 입력 (team 값이 TEAM_BADGE_MAP 키와 일치해야 함)
 *  3. npm run seed-employees 실행
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

// ── 팀(team) → 재난 → 배지 매핑표 ────────────────────────
// team 값은 employees.team 컬럼 값과 반드시 일치해야 합니다.
// 파트장은 '통제' 역할인 재난에서만 별도 항목, 나머지는 파트 배지를 공유합니다.
// — 미기재 재난에서는 해당 직원에게 배지가 없으므로 임무 카드가 표시되지 않습니다.
//   (2026-07-04 원칙 확정: 부서-배지 매핑이 불확실하면 비슷해 보이는 배지를 억지로 끌어쓰지
//    않고 미기재로 둔다 — "배지없으면 임무없음". 가스누출의 전기/운영/주차파트가 이 원칙으로
//    배지를 뺀 사례.)
const TEAM_BADGE_MAP: Record<string, Partial<Record<Disaster, string>>> = {
  '센터장': {
    화재: '총괄', 정전: '총괄', 누수: '총괄', '태풍/홍수': '총괄',
    폭설: '총괄', 지진: '총괄', 가스누출: '총괄', 승강기: '총괄', 테러: '총괄',
  },

  // ── 상황실 (비상발령 전담, 전용 배지) ─────────────────────
  '상황실': {
    화재: '상황실', 정전: '상황실', 누수: '상황실', '태풍/홍수': '상황실',
    폭설: '상황실', 지진: '상황실', 가스누출: '상황실', 승강기: '상황실', 테러: '상황실',
  },

  // ── 소방 ────────────────────────────────────────────────
  '소방파트장': {
    화재: '통제',                               // 통제자 (안전관리자)
    정전: '상황', 누수: '응급', '태풍/홍수': '상황',
    폭설: '대응1', 지진: '상황', 가스누출: '대응', 승강기: '대응', 테러: '상황',
  },
  '소방파트': {
    화재: '출동', 정전: '상황', 누수: '응급', '태풍/홍수': '상황',
    폭설: '대응1', 지진: '상황', 가스누출: '대응', 승강기: '대응', 테러: '상황',
  },

  // ── 전기 ────────────────────────────────────────────────
  '전기파트장': {
    정전: '통제',                               // 통제자 (이길호)
    화재: '출동', 누수: '복구E', '태풍/홍수': '대응',
    폭설: '대응2', 지진: '대응2', 승강기: '대응',
    // 가스누출: 통제(기계파트장) 외 부서 미확정 — 배지없음(임무없음)
    // 테러: 해당없음
  },
  '전기파트': {
    화재: '출동', 정전: '대응', 누수: '복구E', '태풍/홍수': '대응',
    폭설: '대응2', 지진: '대응2', 승강기: '대응',
    // 가스누출: 부서 미확정 — 배지없음(임무없음)
  },

  // ── 기계 ────────────────────────────────────────────────
  '기계파트장': {
    '태풍/홍수': '통제', 가스누출: '통제',      // 통제자
    화재: '대응', 정전: '대응', 누수: '응급',
    폭설: '대응2', 지진: '대응1',
    // 승강기, 테러: 해당없음
  },
  '기계파트': {
    화재: '대응', 정전: '대응', 누수: '응급', '태풍/홍수': '대응',
    폭설: '대응2', 지진: '대응1', 가스누출: '대응',
  },

  // ── 건축 ────────────────────────────────────────────────
  '건축파트장': {
    // 통제 역할 없음 → 건축사무와 동일 배지
    화재: '유도',  // 건축사무 유도조와 동일
    정전: '대응', 누수: '복구B', '태풍/홍수': '대응',
    폭설: '대응1', 지진: '대응2', 가스누출: '대피', 테러: '대피',
  },
  '건축파트': {   // 미분류 건축 인원 (기존 호환)
    화재: '유도', 정전: '대응', 누수: '복구B', '태풍/홍수': '대응',
    폭설: '대응1', 지진: '대응2', 가스누출: '대피', 테러: '대피',
  },
  '건축사무': {   // 사무직 (유도조)
    화재: '유도', 정전: '대응', 누수: '복구B', '태풍/홍수': '대응',
    폭설: '대응1', 지진: '대응2', 가스누출: '대피', 테러: '대피',
  },
  '건축현장': {   // 현장직 (방호조)
    화재: '방호', 정전: '대응', 누수: '복구B', '태풍/홍수': '대응',
    폭설: '대응1', 지진: '대응2', 가스누출: '대피', 테러: '대피',
  },

  // ── 운영 ────────────────────────────────────────────────
  '운영파트장': {
    // 통제 역할 없음 → 파트 배지와 동일
    화재: '유도', 정전: '지원', 누수: '관리', '태풍/홍수': '지원',
    폭설: '대응1', 지진: '지원', 테러: '지원',
    // 가스누출: 부서 미확정 — 배지없음(임무없음)
  },
  '운영파트': {
    화재: '유도', 정전: '지원', 누수: '관리', '태풍/홍수': '지원',
    폭설: '대응1', 지진: '지원', 테러: '지원',
    // 가스누출: 부서 미확정 — 배지없음(임무없음)
  },

  // ── 보안 (화재 시 3개 조로 분리) ─────────────────────────
  '보안1': { // 인명구조조
    화재: '구조',
    정전: '지원', 누수: '유도', '태풍/홍수': '지원',
    폭설: '지원2', 지진: '대피', 가스누출: '대피', 승강기: '통제', 테러: '통제',
  },
  '보안2': { // 대피유도조
    화재: '유도',
    정전: '지원', 누수: '유도', '태풍/홍수': '지원',
    폭설: '지원2', 지진: '대피', 가스누출: '대피', 승강기: '통제', 테러: '통제',
  },
  '보안3': { // 경계/통제조
    // 화재: '통제'는 소방파트장 임무와 뒤섞이는 버그라 삭제 — 배지없음(임무없음)
    정전: '지원', 누수: '유도', '태풍/홍수': '지원',
    폭설: '지원2', 지진: '대피', 가스누출: '대피', 승강기: '통제', 테러: '통제',
  },

  // ── 미화 ────────────────────────────────────────────────
  '미화파트': {
    화재: '복구', 정전: '대응', 누수: '복구B', '태풍/홍수': '통제',
    폭설: '지원1', 지진: '대응1', 가스누출: '대피', 승강기: '지원',
    // 테러: 해당없음
  },

  // ── 주차 ────────────────────────────────────────────────
  '주차파트': {
    화재: '유도', 정전: '유도', 누수: '유도',
    '태풍/홍수': '지원', 폭설: '지원3',
    지진: '유도', 테러: '유도',
    // 가스누출: 부서 미확정 — 배지없음(임무없음)
    // 승강기: 해당없음
  },

  // ── 품질/안전 ────────────────────────────────────────────
  '품질/안전파트': {
    화재: '유도', 누수: '지원', 폭설: '대응2',
    // 나머지 재난: 해당없음
  },
};

// ── 직원 데이터 ──────────────────────────────────────────
// team 값은 반드시 TEAM_BADGE_MAP 의 키와 일치해야 합니다.
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

  // ── 운영 ───────────────────────────────────────────────
  { emp_no: 'E-1001', name: '곽우람', team: '운영파트장', role: '파트장',      is_commander: false, email: 'mprokmc@sni.co.kr',  phone: '010-6251-9466', dept_code: '운영' },
  { emp_no: 'E-1002', name: '엄성철', team: '운영파트',   role: '파트원',      is_commander: false, email: 'sceom@sni.co.kr',    phone: '010-3384-0248', dept_code: '운영' },
  { emp_no: 'E-1003', name: '박세훈', team: '운영파트',   role: '파트원',      is_commander: false, email: 'sehunpark@sni.co.kr',phone: '010-4776-7305', dept_code: '운영' },
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
  { emp_no: 'E-3007', name: '이찬희', team: '전기파트',   role: '파트원(교대)',is_commander: false, email: 'chunww1@sni.co.kr',   phone: '010-4809-5710', dept_code: '교대전기' },
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

  // ── 보안 (화재시 보안1/2/3 구분) ─────────────────────
  { emp_no: 'E-7001', name: '김우현', team: '보안1', role: '파트원', is_commander: false, email: 'kwh12@snipartner.co.kr',             phone: '010-9396-7173', dept_code: '보안1' },
  { emp_no: 'E-7002', name: '김정수', team: '보안2', role: '파트원', is_commander: false, email: 'agito2001@snipartner.co.kr',         phone: '010-9201-0039', dept_code: '보안2' },
  { emp_no: 'E-7003', name: '김병찬', team: '보안2', role: '파트원', is_commander: false, email: 'greenday@snipartner.co.kr',          phone: '010-7750-9488', dept_code: '보안2' },
  { emp_no: 'E-7004', name: '길성용', team: '보안3', role: '파트원', is_commander: false, email: 'ksy84@snipartner.co.kr',             phone: '010-7199-5276', dept_code: '보안3' },
  { emp_no: 'E-7005', name: '김성진', team: '보안3', role: '파트원', is_commander: false, email: 'sungjin1116.kim@lgepartner.com',     phone: '010-6579-1116', dept_code: '보안3' },
  { emp_no: 'E-7006', name: '문상균', team: '보안3', role: '파트원', is_commander: false, email: 'sanggyun.moon@snipartner.co.kr',     phone: '010-6625-2621', dept_code: '보안3' },

  // ── 주차 ───────────────────────────────────────────────
  { emp_no: 'E-9001', name: '김재석', team: '주차파트', role: '파트원', is_commander: false, email: 'ooollpp@snipartner.co.kr',        phone: '010-5618-3369', dept_code: '주차' },

  // ── 미화 ───────────────────────────────────────────────
  { emp_no: 'E-8001', name: '지정운', team: '미화파트', role: '파트원', is_commander: false, email: 'jjw082300@snipartner.co.kr',      phone: '010-3653-1016', dept_code: '미화' },

  // ── 상황실 교대 공석 (채용 예정) ─────────────────────────
  // D조 전기 근무자 — 채용 후 emp_no/name 추가
  // { emp_no: 'SS-D03', name: '채용예정', team: '상황실', role: '교대원(D조)', is_commander: false, dept_code: '야전기', shift_group: 'D' },
];

// ── 상황실 전용 역할/임무 시드 ────────────────────────────
async function seedSituationRoomRoles() {
  console.log('\n상황실 역할/임무 시드 시작...\n');

  // 비화재 재난용 공통 임무
  const genericTasks = [
    '◇ 상황 접수 및 보고',
    '┖ 재난 위치·종류·규모 확인',
    '┖ 지휘관(센터장)에게 즉시 보고',
    '┖ 비상발령 시스템 가동 확인 (사이렌·방송)',
    '◇ 유관기관 연락',
    '┖ 소방서 신고 (☎ 119)',
    '┖ 경찰서 신고 (☎ 112)',
    '◇ 현장 지원 및 기록',
    '┖ 대원 집결 현황 실시간 확인',
    '┖ 대응 진행 상황 기록',
    '┖ 상황 종료 보고 작성',
  ];

  // 화재 감지기동작 시 임무 (감지기 발령 즉시 부여)
  const fireDetectorTasks = [
    '◇ 1분 이내',
    '┖ Ch1,2 무전기로 보안·시설파트·주차 상황전파 출동요청',
    '┖ 상황실 BMS 및 1층 보안근무자 현장출동',
    '┖ 야간) 전기근무자 현장출동, 운전근무자 상황실 이동',
    '┖ 주간) 초기출동조(소방·전기 근무자) 비상장비 착용·휴대 출동',
    '┖ 수신기 감지위치 도면 사진찍어 단톡 공지',
    '┖ 소방·보안근무자 무전기로 위치 상세 설명',
    '┖ (기타) 자탐구역·재연구역·방수구역 도면제공',
    '┖ 층별 근무자 비상연락 — 화재여부 확인 요청',
    '┖ 미화·층별보안·입주사 담당 가까운 위치 근무자 연락',
    '┖ 해당 위치 카메라 검색 (서관 2~36층·동관 5층 확인불가)',
    '◇ 1분 이후 소방설비 확인',
    '┖ 비상방송·경종·시각경보 정상동작 확인 (화재층 및 직상4개층)',
    '┖ 전층 출입통제설비·스피드게이트 동작상태 확인',
    '┖ 기타 소화·경보·소화활동 소방설비 동작상태 확인',
    '┖ 방화셔터·방화문 피난방화설비 동작상태 확인',
    '┖ 전층 공조설비 OFF + 샌드위치가압설비 동작확인',
    '┖ 비상조명 점등 상태 확인',
    '┖ 입주사 담당자등 비상문자 발송',
    '┖ 관계자(센터장·안전관리자등) 연락',
    '┖ 민원전화 응대 (임무 후 후순위)',
    '┖ 대피 질의시 "일단 대피하시고 안내방송 참조" 안내',
    '◇ 비화재보 처리 (비화재보 판명시)',
    '┖ 경보·비상방송 정지 우선조치',
    '┖ 기타 소방설비 연동정지',
    '┖ 경보층에 오보임을 알리는 안내방송 송출',
    '┖ 경보층 확인',
    '┖ 출입통제·조명·공조설비등 화재연동 복구',
    '┖ IOC RMS 정지요청',
    '┖ 관계자(센터장·안전관리자) 전화 보고',
    '┖ 주간(07~20시): 문자 발송 (SNI·주엘지·해당입주사 담당자)',
    '┖ 야간(20~07시): 오전 07시 해당층 입주사 + LG 담당자',
    '┖ 문자보고 프로세서 (BMS Phone 010-7716-8449)',
  ];

  // 화재 확인 시 임무 (화재 승격 후 추가 부여)
  const fireEscalateTasks = [
    '◇ 화재시 설비 연동',
    '┖ 출입통제설비 해정(Unlocked), 스피드게이트 Open 연동확인',
    '┖ 일반용 E/V 파킹(수동), 비상용-운전자 연락, 오티스 연락',
    '┖ 피난유도: 평일주간 우선경보 → 소방계획서 기준',
    '┖ 야간·휴일: 전층 피난유도',
    '◇ 화재시 비상연락',
    '┖ 119 화재신고, 상세히 정보제공',
    '┖ 주간: 자위소방대 비상연락(무전·톡), 관계자(센터장·안전관리자)',
    '┖ 주간: 어린이집·VIP보안 화재전파',
    '┖ 야간: 시설·미화·보안·주차 근무자, 특히 미화감독 연락',
    '┖ 관계자·입주사 담당자등 화재상황 문자 보고',
    '┖ 종합상황실 상황보고',
    '┖ 화재진행·설비동작·119·요구조자·피난상황 현황판 작성',
    '◇ 화재진압 후',
    '┖ 경보·비상방송 정지등 소방시설 연동정지 및 수신반 복구',
    '┖ 승강기운행·출입통제·스피드게이트·공조설비등 복구',
    '┖ IOC RMS 정지요청',
    '┖ 화재진압에 따른 전층 안내방송 송출',
    '┖ 입주사 담당자등 상황종료 문자 발송',
  ];

  for (const disaster of DISASTERS) {
    const tasks = disaster === '화재' ? fireDetectorTasks : genericTasks;

    // badge '상황실' — 감지기동작 시 즉시 부여 임무
    const { data: role, error: roleErr } = await supabase
      .from('disaster_roles')
      .upsert(
        { disaster, group_name: '상황실', role: '📻 상황실', badge: '상황실', bc: '#312e81' },
        { onConflict: 'disaster,shift,badge' }
      )
      .select()
      .single();

    if (roleErr) {
      console.error(`  ✗ 상황실 역할 오류 [${disaster}]:`, roleErr.message);
      continue;
    }

    await supabase.from('disaster_tasks').delete().eq('role_id', role.id);
    const taskRows = tasks.map((label, idx) => ({ role_id: role.id, task_idx: idx, label }));
    const { error: taskErr } = await supabase.from('disaster_tasks').insert(taskRows);
    if (taskErr) {
      console.error(`  ✗ 상황실 임무 오류 [${disaster}]:`, taskErr.message);
    } else {
      console.log(`  ✓ ${disaster} 상황실 — ${taskRows.length}개 임무`);
    }

    // 화재 전용: badge '상황실/화재' — 화재 승격 후 추가 부여 임무
    if (disaster === '화재') {
      const { data: fireRole, error: fireRoleErr } = await supabase
        .from('disaster_roles')
        .upsert(
          { disaster: '화재', group_name: '상황실', role: '📻 상황실/화재', badge: '상황실/화재', bc: '#1e40af' },
          { onConflict: 'disaster,shift,badge' }
        )
        .select()
        .single();

      if (fireRoleErr) {
        console.error('  ✗ 상황실/화재 역할 오류:', fireRoleErr.message);
      } else {
        await supabase.from('disaster_tasks').delete().eq('role_id', fireRole.id);
        const fireTaskRows = fireEscalateTasks.map((label, idx) => ({ role_id: fireRole.id, task_idx: idx, label }));
        const { error: fireTaskErr } = await supabase.from('disaster_tasks').insert(fireTaskRows);
        if (fireTaskErr) {
          console.error('  ✗ 상황실/화재 임무 오류:', fireTaskErr.message);
        } else {
          console.log(`  ✓ 화재 상황실/화재 — ${fireTaskRows.length}개 임무 (화재 승격 시 추가)`);
        }
      }
    }
  }

  console.log('\n상황실 시드 완료!');
}

// ── 시드 실행 ──────────────────────────────────────────────
async function seed() {
  console.log(`\n직원 시드 시작 (${EMPLOYEES.length}명)...\n`);

  // SS-* 중복 항목 삭제 (이전 seed에서 잘못 생성된 항목 정리)
  const { error: delBadgeErr } = await supabase.from('employee_disaster_badges').delete().like('emp_no', 'SS-%');
  if (delBadgeErr) console.error('  ✗ SS-* 배지 삭제 오류:', delBadgeErr.message);
  else console.log('  🗑 SS-* 배지 항목 삭제 완료');
  const { error: delEmpErr } = await supabase.from('employees').delete().like('emp_no', 'SS-%');
  if (delEmpErr) console.error('  ✗ SS-* 직원 삭제 오류:', delEmpErr.message);
  else console.log('  🗑 SS-* 직원 항목 삭제 완료\n');

  for (const emp of EMPLOYEES) {
    // 1. employees upsert
    const { error: empErr } = await supabase
      .from('employees')
      .upsert(emp, { onConflict: 'emp_no' });
    if (empErr) { console.error(`  ✗ ${emp.name} 직원 오류:`, empErr.message); continue; }

    // 2. employee_disaster_badges upsert (팀 매핑 기준)
    const teamMap = TEAM_BADGE_MAP[emp.team];
    if (!teamMap) {
      console.warn(`  ⚠ ${emp.name} — team "${emp.team}" 이(가) TEAM_BADGE_MAP 에 없습니다.`);
      continue;
    }

    const badges: { emp_no: string; disaster: string; badge: string }[] = [];
    for (const disaster of DISASTERS) {
      const badge = teamMap[disaster];
      if (badge) badges.push({ emp_no: emp.emp_no, disaster, badge });
    }

    if (badges.length > 0) {
      const { error: badgeErr } = await supabase
        .from('employee_disaster_badges')
        .upsert(badges, { onConflict: 'emp_no,disaster' });
      if (badgeErr) console.error(`  ✗ ${emp.name} 배지 오류:`, badgeErr.message);
    }

    const badgeSummary = DISASTERS
      .map(d => teamMap[d] ? `${d}:${teamMap[d]}` : null)
      .filter(Boolean).join(', ');
    console.log(`  ✓ ${emp.name} (${emp.team}) → ${badgeSummary}`);
  }

  console.log('\n직원 시드 완료!');
  await seedSituationRoomRoles();
}

seed().catch(console.error);
