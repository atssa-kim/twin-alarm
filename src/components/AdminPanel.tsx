import React, { useState, useMemo } from 'react';
import { db, type EmployeeDB } from '../services/supabase';
import { UserPlus, Pencil, Trash2, X, Save, Users, ChevronDown, Copy, ExternalLink } from 'lucide-react';

// ── 팀 목록 (seed-employees.ts team 값과 일치) ──────────────
const ALL_TEAMS = [
  '센터장', '상황실',
  '운영파트장', '운영파트',
  '건축파트장', '건축사무', '건축현장', '건축파트',
  '기계파트장', '기계파트',
  '전기파트장', '전기파트',
  '소방파트장', '소방파트',
  '품질/안전파트',
  '보안1', '보안2', '보안3',
  '주차파트', '미화파트',
];

// ── 카테고리(부서)별 팀 그룹핑 — 좌측 세로 메뉴 순서: 전체/운영/소방/전기/기계/건축/안전/보안/주차/미화/교대
// 각 부서는 파트장·파트원 팀을 모두 포함한다. 교대 근무자는 소속 부서에서 빼서 "교대" 카테고리로 별도 구성.
const TEAM_CATEGORIES: { label: string; teams: string[] | null; shiftOnly?: boolean }[] = [
  { label: '전체', teams: null },
  { label: '운영', teams: ['센터장', '상황실', '운영파트장', '운영파트'] },
  { label: '소방', teams: ['소방파트장', '소방파트'] },
  { label: '전기', teams: ['전기파트장', '전기파트'] },
  { label: '기계', teams: ['기계파트장', '기계파트'] },
  { label: '건축', teams: ['건축파트장', '건축사무', '건축현장', '건축파트'] },
  { label: '안전', teams: ['품질/안전파트'] },
  { label: '보안', teams: ['보안1', '보안2', '보안3'] },
  { label: '주차', teams: ['주차파트'] },
  { label: '미화', teams: ['미화파트'] },
  { label: '교대', teams: null, shiftOnly: true },
];

const isDeptLeader = (e: EmployeeDB) => e.team.endsWith('파트장') || e.team === '센터장';

// ── 교대 근무자: role에서 A/B/C/D조 및 조장 여부 추출 ──────────
const SHIFT_ORDER = ['A', 'B', 'C', 'D', '기타'];
const isShiftEmp = (e: EmployeeDB) => e.role.includes('교대');
const isShiftLeader = (e: EmployeeDB) => e.role.includes('조장');
const getShiftLetter = (role: string) => role.match(/([A-D])조/)?.[1] ?? '기타';

// ── 재난 편제표: 좌측 세로 메뉴 순서 및 표시 라벨 ──────────────
const ORG_DISASTER_ORDER: Disaster[] = ['화재', '누수', '정전', '지진', '태풍/홍수', '가스누출', '폭설', '승강기', '테러'];
const DISASTER_LABELS: Record<Disaster, string> = {
  '화재': '화재', '누수': '누수', '정전': '정전', '지진': '지진',
  '태풍/홍수': '풍수', '가스누출': '가스누출', '폭설': '폭설',
  '승강기': '승강기갇힘', '테러': '테러',
};

// ── 팀 → 재난 배지 자동매핑 (seed-employees.ts 동일) ────────
type Disaster = '화재'|'정전'|'누수'|'태풍/홍수'|'폭설'|'지진'|'가스누출'|'승강기'|'테러';
const ALL_DISASTERS: Disaster[] = ['화재','정전','누수','태풍/홍수','폭설','지진','가스누출','승강기','테러'];

const TEAM_BADGE_MAP: Record<string, Partial<Record<Disaster, string>>> = {
  '센터장':  { 화재:'총괄', 정전:'총괄', 누수:'총괄', '태풍/홍수':'총괄', 폭설:'총괄', 지진:'총괄', 가스누출:'총괄', 승강기:'총괄', 테러:'총괄' },
  '상황실':  { 화재:'상황실', 정전:'상황실', 누수:'상황실', '태풍/홍수':'상황실', 폭설:'상황실', 지진:'상황실', 가스누출:'상황실', 승강기:'상황실', 테러:'상황실' },
  '소방파트장': { 화재:'통제', 정전:'상황', 누수:'응급', '태풍/홍수':'상황', 폭설:'대응1', 지진:'상황', 가스누출:'대응', 승강기:'대응', 테러:'상황' },
  '소방파트':   { 화재:'출동', 정전:'상황', 누수:'응급', '태풍/홍수':'상황', 폭설:'대응1', 지진:'상황', 가스누출:'대응', 승강기:'대응', 테러:'상황' },
  '전기파트장': { 화재:'출동', 정전:'통제', 누수:'복구E', '태풍/홍수':'대응', 폭설:'대응2', 지진:'대응2', 가스누출:'지원', 승강기:'대응' },
  '전기파트':   { 화재:'출동', 정전:'대응', 누수:'복구E', '태풍/홍수':'대응', 폭설:'대응2', 지진:'대응2', 가스누출:'지원', 승강기:'대응' },
  '기계파트장': { 화재:'소화', 정전:'대응', 누수:'응급', '태풍/홍수':'통제', 폭설:'대응2', 지진:'대응1', 가스누출:'통제' },
  '기계파트':   { 화재:'소화', 정전:'대응', 누수:'응급', '태풍/홍수':'대응', 폭설:'대응2', 지진:'대응1', 가스누출:'대응' },
  '건축파트장': { 화재:'유도', 정전:'대응', 누수:'복구B', '태풍/홍수':'대응', 폭설:'대응1', 지진:'대응2', 가스누출:'대피', 테러:'대피' },
  '건축사무':   { 화재:'유도', 정전:'대응', 누수:'복구B', '태풍/홍수':'대응', 폭설:'대응1', 지진:'대응2', 가스누출:'대피', 테러:'대피' },
  '건축현장':   { 화재:'방호', 정전:'대응', 누수:'복구B', '태풍/홍수':'대응', 폭설:'대응1', 지진:'대응2', 가스누출:'대피', 테러:'대피' },
  '건축파트':   { 화재:'유도', 정전:'대응', 누수:'복구B', '태풍/홍수':'대응', 폭설:'대응1', 지진:'대응2', 가스누출:'대피', 테러:'대피' },
  '운영파트장': { 화재:'유도', 정전:'지원', 누수:'관리', '태풍/홍수':'지원', 폭설:'대응1', 지진:'지원', 가스누출:'지원', 테러:'지원' },
  '운영파트':   { 화재:'유도', 정전:'지원', 누수:'관리', '태풍/홍수':'지원', 폭설:'대응1', 지진:'지원', 가스누출:'지원', 테러:'지원' },
  '보안1': { 화재:'구조', 정전:'지원', 누수:'유도', '태풍/홍수':'지원', 폭설:'지원2', 지진:'대피', 가스누출:'대피', 승강기:'통제', 테러:'통제' },
  '보안2': { 화재:'유도', 정전:'지원', 누수:'유도', '태풍/홍수':'지원', 폭설:'지원2', 지진:'대피', 가스누출:'대피', 승강기:'통제', 테러:'통제' },
  '보안3': { 화재:'통제', 정전:'지원', 누수:'유도', '태풍/홍수':'지원', 폭설:'지원2', 지진:'대피', 가스누출:'대피', 승강기:'통제', 테러:'통제' },
  '미화파트': { 화재:'복구', 정전:'대응', 누수:'복구B', '태풍/홍수':'통제', 폭설:'지원1', 지진:'대응1', 가스누출:'대피', 승강기:'지원' },
  '주차파트': { 화재:'유도', 정전:'유도', 누수:'유도', '태풍/홍수':'지원', 폭설:'지원3', 지진:'유도', 가스누출:'유도', 테러:'유도' },
  '품질/안전파트': { 화재:'유도', 누수:'지원', 폭설:'대응2' },
};

const RLS_FIX_SQL =
  `ALTER TABLE employees DISABLE ROW LEVEL SECURITY;\nALTER TABLE employee_disaster_badges DISABLE ROW LEVEL SECURITY;`;
const SUPABASE_SQL_URL = 'https://supabase.com/dashboard/project/hzqesdprnlpzaomaeswx/sql/new';

// ── 전화번호 자동 포맷 ───────────────────────────────────────
const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};

const generateEmpNo = () => `E${Date.now().toString().slice(-7)}`;

const getLocalPart = (email: string) =>
  email.endsWith('@sni.co.kr') ? email.slice(0, -'@sni.co.kr'.length) : email;

interface FormState {
  emp_no: string;
  name: string;
  team: string;
  role: string;
  is_commander: boolean;
  phone: string;
  email: string;
}

const EMPTY_FORM: FormState = {
  emp_no: '', name: '', team: '운영파트', role: '파트원',
  is_commander: false, phone: '', email: '',
};

interface AdminPanelProps {
  employees: EmployeeDB[];
  onRefresh: () => void;
}

// ── 편제표: 재난별 그룹 분류 ────────────────────────────────
const CMD_TEAMS: Record<string, string[]> = {
  '화재':     ['소방파트장'],
  '정전':     ['전기파트장'],
  '누수':     ['기계파트장'],
  '태풍/홍수': ['소방파트장'],
  '폭설':     ['운영파트장'],
  '지진':     ['소방파트장'],
  '가스누출':  ['기계파트장'],
  '승강기':   [],
  '테러':     [],
};
const EVAC_TEAMS: Record<string, string[]> = {
  '화재':     ['보안1','보안2','보안3','운영파트장','운영파트','주차파트','품질/안전파트','미화파트'],
  '정전':     ['보안1','보안2','보안3','운영파트장','운영파트','미화파트','주차파트'],
  '누수':     ['보안1','보안2','보안3','운영파트장','운영파트'],
  '태풍/홍수': ['보안1','보안2','보안3','소방파트장','소방파트','운영파트장','운영파트'],
  '폭설':     ['미화파트','보안1','보안2','보안3','주차파트'],
  '지진':     ['보안1','보안2','보안3','운영파트장','운영파트'],
  '가스누출':  ['건축파트장','건축파트','보안1','보안2','보안3','미화파트'],
  '승강기':   ['보안1','보안2','보안3','미화파트'],
  '테러':     ['운영파트장','운영파트','건축파트장','건축파트'],
};
type OrgGroup = '지휘연락' | '현장대응' | '대피지원' | '교대';
const getOrgGroup = (team: string, role: string, disaster: string): OrgGroup => {
  if (role.includes('교대')) return '교대';
  if (team === '상황실' || team === '센터장') return '지휘연락';
  if ((CMD_TEAMS[disaster] ?? []).includes(team)) return '지휘연락';
  if ((EVAC_TEAMS[disaster] ?? []).includes(team)) return '대피지원';
  return '현장대응';
};
const ORG_GROUPS: { key: OrgGroup; color: string }[] = [
  { key: '지휘연락', color: '#f59e0b' },
  { key: '현장대응', color: '#ef4444' },
  { key: '대피지원', color: '#60a5fa' },
  { key: '교대',    color: '#c084fc' },
];

export const AdminPanel: React.FC<AdminPanelProps> = ({ employees, onRefresh }) => {
  const [adminTab, setAdminTab] = useState<'list' | 'org'>('list');
  const [orgDisaster, setOrgDisaster] = useState<Disaster>('화재');
  const [filterCategory, setFilterCategory] = useState('전체');
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editEmpNo, setEditEmpNo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [expandedOrgGroup, setExpandedOrgGroup] = useState<OrgGroup | null>(null);
  const [rlsError, setRlsError] = useState(false);
  const [copied, setCopied] = useState(false);

  const categoryTeams = useMemo(() => {
    const cat = TEAM_CATEGORIES.find(c => c.label === filterCategory);
    return cat?.teams ?? null;
  }, [filterCategory]);

  const filtered = useMemo(() => {
    let list = employees;
    if (categoryTeams) list = list.filter(e => categoryTeams.includes(e.team));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e =>
        e.name.includes(q) || e.role.toLowerCase().includes(q) || e.emp_no.includes(q)
      );
    }
    return [...list].sort((a, b) =>
      a.team.localeCompare(b.team, 'ko') || a.name.localeCompare(b.name, 'ko')
    );
  }, [employees, categoryTeams, search]);

  // 부서(카테고리)별로 파트장·파트원을 한데 묶은 아코디언 그룹. 교대 근무자는 소속 부서에서 빼서
  // "교대" 카테고리로 모으고, 그 안에서 다시 A/B/C/D조로 나눠 조장을 조원보다 앞에 배치한다.
  const departmentGroups = useMemo(() => {
    const depts = filterCategory === '전체'
      ? TEAM_CATEGORIES.filter(c => c.label !== '전체')
      : TEAM_CATEGORIES.filter(c => c.label === filterCategory);
    return depts
      .map(dept => {
        if (dept.shiftOnly) {
          const shiftEmps = filtered.filter(isShiftEmp);
          const buckets: Record<string, EmployeeDB[]> = {};
          for (const e of shiftEmps) (buckets[getShiftLetter(e.role)] ??= []).push(e);
          const shiftGroups = SHIFT_ORDER
            .filter(s => buckets[s]?.length)
            .map(s => ({
              shift: s,
              emps: buckets[s].sort((a, b) => {
                const lead = Number(isShiftLeader(b)) - Number(isShiftLeader(a));
                return lead || a.name.localeCompare(b.name, 'ko');
              }),
            }));
          return { label: dept.label, emps: shiftEmps, shiftGroups };
        }
        return {
          label: dept.label,
          emps: filtered
            .filter(e => dept.teams!.includes(e.team) && !isShiftEmp(e))
            .sort((a, b) => {
              const lead = Number(isDeptLeader(b)) - Number(isDeptLeader(a));
              return lead || a.name.localeCompare(b.name, 'ko');
            }),
          shiftGroups: undefined as { shift: string; emps: EmployeeDB[] }[] | undefined,
        };
      })
      .filter(d => d.emps.length > 0);
  }, [filtered, filterCategory]);

  // 현재 팀의 자동 배지 미리보기
  const autoBadgePreview = useMemo(() => {
    const map = TEAM_BADGE_MAP[form.team];
    if (!map) return [];
    return ALL_DISASTERS.filter(d => map[d]).map(d => ({ disaster: d, badge: map[d]! }));
  }, [form.team]);

  // 편제표: 재난별 그룹 계산
  const orgGroups = useMemo(() => {
    const groups: Record<OrgGroup, EmployeeDB[]> = { '지휘연락': [], '현장대응': [], '대피지원': [], '교대': [] };
    for (const e of employees) {
      groups[getOrgGroup(e.team, e.role, orgDisaster)].push(e);
    }
    return groups;
  }, [employees, orgDisaster]);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, emp_no: generateEmpNo() });
    setEditEmpNo(null);
    setModalMode('add');
  };

  const openEdit = async (emp: EmployeeDB) => {
    setForm({
      emp_no: emp.emp_no, name: emp.name, team: emp.team,
      role: emp.role, is_commander: emp.is_commander,
      phone: emp.phone ?? '', email: emp.email ?? '',
    });
    setEditEmpNo(emp.emp_no);
    setModalMode('edit');
  };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('이름을 입력하세요.');
    if (!form.phone.trim()) return alert('전화번호를 입력하세요 (로그인 비밀번호로 사용).');

    const empNo = modalMode === 'add' ? generateEmpNo() : form.emp_no;
    const emailVal = form.email.trim();
    const finalEmail = (!emailVal || emailVal === '@sni.co.kr') ? undefined : emailVal;

    setSaving(true);
    try {
      const empData: EmployeeDB = {
        emp_no: empNo,
        name: form.name.trim(),
        team: form.team,
        role: form.role.trim(),
        is_commander: form.is_commander,
        phone: form.phone.trim(),
        email: finalEmail,
      };

      if (modalMode === 'add') {
        await db.addEmployee(empData);
      } else if (modalMode === 'edit' && editEmpNo) {
        await db.updateEmployee(editEmpNo, empData);
      }

      // 팀 기반 재난 배지 자동 적용
      const targetEmpNo = modalMode === 'edit' ? (editEmpNo ?? empNo) : empNo;
      const badgeMap = TEAM_BADGE_MAP[form.team] ?? {};
      for (const disaster of ALL_DISASTERS) {
        const badge = badgeMap[disaster];
        if (badge) {
          await db.upsertEmployeeBadge(targetEmpNo, disaster, badge);
        } else {
          try { await db.deleteEmployeeBadge(targetEmpNo, disaster); } catch { /* 없으면 무시 */ }
        }
      }

      setModalMode(null);
      onRefresh();
    } catch (err: any) {
      if (err.message?.includes('row-level security') || err.code === '42501') {
        setRlsError(true);
      } else {
        alert('저장 실패: ' + (err.message ?? err));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (emp: EmployeeDB) => {
    if (!window.confirm(`[${emp.name}] 직원을 삭제하시겠습니까?`)) return;
    try {
      await db.deleteEmployee(emp.emp_no);
      onRefresh();
    } catch (err: any) {
      if (err.message?.includes('row-level security') || err.code === '42501') {
        setRlsError(true);
      } else {
        alert('삭제 실패: ' + (err.message ?? err));
      }
    }
  };

  const handleCopySQL = () => {
    navigator.clipboard.writeText(RLS_FIX_SQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: '#1e293b',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px', color: '#e2e8f0',
    fontSize: '13px', outline: 'none', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    display: 'block', marginBottom: '5px',
  };

  return (
    <div className="content" style={{ gap: '12px' }}>

      {/* RLS 오류 안내 모달 */}
      {rlsError && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '420px', background: '#0f172a', borderRadius: '16px',
            border: '1px solid rgba(239,68,68,0.4)', padding: '24px',
            display: 'flex', flexDirection: 'column', gap: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>🔒</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#fca5a5' }}>RLS 정책 오류</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  Supabase SQL Editor에서 1회 실행 필요
                </div>
              </div>
              <button onClick={() => setRlsError(false)} style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{
              background: 'rgba(0,0,0,0.4)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)',
              padding: '12px 14px', fontFamily: 'monospace', fontSize: '12px', color: '#7dd3fc', lineHeight: 1.8,
            }}>
              {RLS_FIX_SQL.split('\n').map((line, i) => <div key={i}>{line}</div>)}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleCopySQL} style={{
                flex: 1, padding: '11px', borderRadius: '8px', cursor: 'pointer',
                background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)',
                border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'rgba(59,130,246,0.4)'}`,
                color: copied ? '#34d399' : '#60a5fa', fontSize: '13px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}>
                <Copy size={14} />{copied ? '복사 완료!' : 'SQL 복사'}
              </button>
              <button onClick={() => window.open(SUPABASE_SQL_URL, '_blank')} style={{
                flex: 1, padding: '11px', borderRadius: '8px', cursor: 'pointer',
                background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
                color: '#34d399', fontSize: '13px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}>
                <ExternalLink size={14} />Supabase 열기
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#475569', textAlign: 'center' }}>
              SQL 복사 → Supabase 열기 → SQL Editor 붙여넣기 → Run
            </div>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Users size={18} color="#60a5fa" />
        <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0, flex: 1 }}>인원 관리</h2>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '6px' }}>
          총 {employees.length}명
        </span>
        {adminTab === 'list' && (
          <button onClick={openAdd} style={{
            display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px', cursor: 'pointer',
            background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#60a5fa', fontSize: '12px', fontWeight: 700,
          }}>
            <UserPlus size={14} />직원 추가
          </button>
        )}
      </div>

      {/* 탭 스위처 */}
      <div style={{ display: 'flex', background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '3px', gap: '3px' }}>
        {([
          { key: 'list' as const, label: '👥 직원 목록' },
          { key: 'org'  as const, label: '🗂 재난 편제표' },
        ]).map(tab => (
          <button key={tab.key} type="button" onClick={() => setAdminTab(tab.key)} style={{
            flex: 1, padding: '8px 0', fontSize: '12px', fontWeight: 700, cursor: 'pointer', borderRadius: '7px',
            background: adminTab === tab.key ? 'rgba(59,130,246,0.2)' : 'transparent',
            border: adminTab === tab.key ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
            color: adminTab === tab.key ? '#60a5fa' : '#64748b',
            transition: 'all 0.15s',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── 편제표 탭: 좌측 재난 세로 메뉴 + 우측 서브메뉴 아코디언 ── */}
      {adminTab === 'org' && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          {/* 좌측 세로 메뉴 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '76px', flexShrink: 0 }}>
            {ORG_DISASTER_ORDER.map(d => (
              <button key={d} type="button" onClick={() => { setOrgDisaster(d); setExpandedOrgGroup(null); }} style={{
                padding: '10px 4px', borderRadius: '8px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 700, textAlign: 'center',
                background: orgDisaster === d ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${orgDisaster === d ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: orgDisaster === d ? '#60a5fa' : 'var(--text-muted)',
              }}>
                {DISASTER_LABELS[d]}
              </button>
            ))}
          </div>

          {/* 우측 서브메뉴바 (아코디언) */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {ORG_GROUPS.map(({ key: grp, color }) => {
              const grpEmps = orgGroups[grp];
              const teamMap: Record<string, EmployeeDB[]> = {};
              for (const emp of grpEmps) (teamMap[emp.team] ??= []).push(emp);
              const isOpen = expandedOrgGroup === grp;

              return (
                <div key={grp} style={{ border: `1px solid ${color}33`, borderRadius: '10px', overflow: 'hidden' }}>
                  <div onClick={() => setExpandedOrgGroup(isOpen ? null : grp)} style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', cursor: 'pointer',
                    background: `${color}10`, borderBottom: isOpen ? `1px solid ${color}22` : 'none',
                  }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', fontWeight: 800, color, flex: 1 }}>{grp}</span>
                    <span style={{ fontSize: '11px', color: color + 'aa', fontWeight: 600 }}>{grpEmps.length}명</span>
                    <ChevronDown size={14} color={color}
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </div>
                  {isOpen && (
                    grpEmps.length === 0 ? (
                      <div style={{ padding: '10px 14px', fontSize: '12px', color: '#475569', textAlign: 'center' }}>해당 없음</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {Object.entries(teamMap).map(([team, teamEmps]) => {
                          const badge = TEAM_BADGE_MAP[team]?.[orgDisaster];
                          return (
                            <div key={team} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px 4px', background: 'rgba(255,255,255,0.02)' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', flex: 1 }}>{team}</span>
                                {badge && (
                                  <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '4px', background: color + '22', color, fontWeight: 700, border: `1px solid ${color}44` }}>
                                    {badge}
                                  </span>
                                )}
                              </div>
                              {teamEmps.map(emp => (
                                <div key={emp.emp_no} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px 4px 20px' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{emp.name}</span>
                                  <span style={{ fontSize: '11px', color: '#64748b' }}>{emp.role}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 직원 목록 탭: 좌측 부서 세로 메뉴 + 우측 검색/아코디언 ── */}
      {adminTab === 'list' && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          {/* 좌측 세로 메뉴 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '76px', flexShrink: 0 }}>
            {TEAM_CATEGORIES.map(cat => (
              <button key={cat.label} type="button" onClick={() => { setFilterCategory(cat.label); setExpandedDept(cat.label === '전체' ? null : cat.label); }} style={{
                padding: '10px 4px', borderRadius: '8px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 700, textAlign: 'center',
                background: filterCategory === cat.label ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${filterCategory === cat.label ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: filterCategory === cat.label ? '#60a5fa' : 'var(--text-muted)',
              }}>
                {cat.label}
              </button>
            ))}
          </div>

          {/* 우측 검색 + 부서별 아코디언 (파트장·파트원 통합) */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input
              type="text" placeholder="이름 · 역할 검색" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
            />

            {departmentGroups.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
                {search ? '검색 결과가 없습니다.' : '등록된 직원이 없습니다.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {departmentGroups.map(dept => (
                  <div key={dept.label} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="accordion-header" onClick={() => setExpandedDept(expandedDept === dept.label ? null : dept.label)} style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 14px',
                      borderBottom: expandedDept === dept.label ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}>
                      <span style={{ fontSize: '13px', fontWeight: 800, flex: 1 }}>{dept.label}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{dept.emps.length}명</span>
                      <ChevronDown size={14} color="var(--text-muted)"
                        style={{ transform: expandedDept === dept.label ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                    </div>
                    {expandedDept === dept.label && (
                      <div>
                        {dept.shiftGroups ? (
                          dept.shiftGroups.map(sg => (
                            <div key={sg.shift}>
                              <div style={{ padding: '6px 14px 5px', fontSize: '11px', fontWeight: 800, color: '#94a3b8', background: 'rgba(255,255,255,0.03)' }}>
                                {sg.shift === '기타' ? '기타' : `${sg.shift}조`} · {sg.emps.length}명
                              </div>
                              {sg.emps.map(emp => <EmpRow key={emp.emp_no} emp={emp} onEdit={openEdit} onDelete={handleDelete} />)}
                            </div>
                          ))
                        ) : (
                          dept.emps.map(emp => <EmpRow key={emp.emp_no} emp={emp} onEdit={openEdit} onDelete={handleDelete} />)
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 추가/편집 모달 ── */}
      {modalMode && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setModalMode(null); }}
        >
          <div style={{
            width: '100%', maxHeight: '90vh', background: '#0f172a',
            borderRadius: '20px 20px 0 0', border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* 모달 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
              <span style={{ fontSize: '15px', fontWeight: 800, flex: 1 }}>
                {modalMode === 'add' ? '직원 추가' : '직원 수정'}
              </span>
              <button onClick={() => setModalMode(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}>
                <X size={20} />
              </button>
            </div>

            {/* 폼 스크롤 영역 */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* 이름 + 사번 */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>이름</label>
                  <input style={inputStyle} value={form.name} autoFocus
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="홍길동" />
                </div>
                <div>
                  <label style={labelStyle}>사번 (자동)</label>
                  <input style={{ ...inputStyle, opacity: 0.3, fontSize: '10px' }} value={form.emp_no} readOnly />
                </div>
              </div>

              {/* 파트 */}
              <div>
                <label style={labelStyle}>파트 (팀)</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.team}
                  onChange={e => setForm(f => ({ ...f, team: e.target.value }))}>
                  {ALL_TEAMS.map(t => (
                    <option key={t} value={t} style={{ background: '#1e293b', color: '#e2e8f0' }}>{t}</option>
                  ))}
                </select>
              </div>

              {/* 재난 배지 자동 적용 안내 */}
              {autoBadgePreview.length > 0 && (
                <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#34d399', marginBottom: '6px' }}>
                    ✓ 파트 선택 시 재난 배지 자동 적용
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {autoBadgePreview.map(({ disaster, badge }) => (
                      <span key={disaster} style={{
                        fontSize: '10px', padding: '2px 7px', borderRadius: '4px',
                        background: 'rgba(16,185,129,0.1)', color: '#6ee7b7',
                        border: '1px solid rgba(16,185,129,0.2)',
                      }}>
                        {disaster} → {badge}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {autoBadgePreview.length === 0 && (
                <div style={{ fontSize: '11px', color: '#475569', padding: '6px 0' }}>
                  이 파트는 재난 배지 매핑이 없습니다.
                </div>
              )}

              {/* 역할 */}
              <div>
                <label style={labelStyle}>역할</label>
                <input style={inputStyle} value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  placeholder="파트장 / 파트원 / 파트원(A조 교대) 등" />
              </div>

              {/* 전화번호 */}
              <div>
                <label style={labelStyle}>
                  전화번호 <span style={{ color: '#f59e0b', fontWeight: 500, textTransform: 'none' }}>* 뒤 4자리 = 로그인 비밀번호</span>
                </label>
                <input style={inputStyle} type="tel" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                  placeholder="숫자만 입력" />
                {form.phone.replace(/\D/g, '').length >= 4 && (
                  <div style={{ marginTop: '5px', fontSize: '11px', color: '#94a3b8' }}>
                    로그인 비밀번호: <strong style={{ color: '#fbbf24' }}>{form.phone.replace(/\D/g, '').slice(-4)}</strong>
                  </div>
                )}
              </div>

              {/* 이메일 */}
              <div>
                <label style={labelStyle}>이메일 (선택)</label>
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                  <input
                    style={{ ...inputStyle, borderRadius: '8px 0 0 8px', flex: 1 }}
                    type="text"
                    value={getLocalPart(form.email)}
                    onChange={e => {
                      const local = e.target.value;
                      setForm(f => ({ ...f, email: local ? `${local}@sni.co.kr` : '' }));
                    }}
                    placeholder="hong.gildong"
                  />
                  <span style={{
                    padding: '0 10px', flexShrink: 0,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
                    borderLeft: 'none', borderRadius: '0 8px 8px 0',
                    color: '#64748b', fontSize: '12px', display: 'flex', alignItems: 'center',
                  }}>@sni.co.kr</span>
                </div>
              </div>

              {/* 지휘관 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                <input type="checkbox" id="is_commander_chk" checked={form.is_commander}
                  onChange={e => setForm(f => ({ ...f, is_commander: e.target.checked }))}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <label htmlFor="is_commander_chk" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: form.is_commander ? '#60a5fa' : '#94a3b8' }}>
                  지휘관 권한 부여 (발령·종료 기능 접근 가능)
                </label>
              </div>
            </div>

            {/* 저장 버튼 */}
            <div style={{ padding: '12px 18px 20px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={handleSave} disabled={saving} style={{
                width: '100%', padding: '13px', borderRadius: '10px',
                cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)',
                border: '1px solid rgba(59,130,246,0.5)', color: '#60a5fa',
                fontSize: '14px', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}>
                <Save size={16} />
                {saving ? '저장 중...' : modalMode === 'add' ? '직원 추가 완료' : '변경사항 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── 직원 행 컴포넌트 ──────────────────────────────────────────────
const EmpRow: React.FC<{
  emp: EmployeeDB;
  onEdit: (emp: EmployeeDB) => void;
  onDelete: (emp: EmployeeDB) => void;
}> = ({ emp, onEdit, onDelete }) => {
  const lastFour = emp.phone?.replace(/\D/g, '').slice(-4) ?? '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700 }}>{emp.name}</span>
          {emp.role.includes('조장') && (
            <span style={{ fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>조장</span>
          )}
          {emp.is_commander && (
            <span style={{ fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', background: 'rgba(59,130,246,0.2)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}>지휘관</span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {emp.role}
          {emp.phone && <span style={{ marginLeft: '8px', color: '#475569' }}>🔑 {lastFour}</span>}
        </div>
      </div>
      <button onClick={() => onEdit(emp)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer', padding: '5px 8px' }}>
        <Pencil size={13} />
      </button>
      <button onClick={() => onDelete(emp)} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', padding: '5px 8px' }}>
        <Trash2 size={13} />
      </button>
    </div>
  );
};
