import React, { useState, useMemo, useEffect } from 'react';
import { db, supabase, type EmployeeDB, type DisasterRole, type DisasterTask } from '../services/supabase';
import { UserPlus, Pencil, Trash2, X, Save, Users, ChevronDown, Copy, ExternalLink, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { IncidentHistoryPanel } from './IncidentHistoryPanel';

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

// ── 재난 배지 ────────────────────────────────────────────
// 2026-07-05: 팀 기준 자동계산(TEAM_BADGE_MAP)을 폐지하고, "재난 편제표" 탭에서
// 배지별로 인원을 직접 배정/해제하는 방식(employee_disaster_badges 직접 관리)으로 전환.
type Disaster = '화재'|'정전'|'누수'|'태풍/홍수'|'폭설'|'지진'|'가스누출'|'승강기'|'테러';
const ALL_DISASTERS: Disaster[] = ['화재','정전','누수','태풍/홍수','폭설','지진','가스누출','승강기','테러'];

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

export const AdminPanel: React.FC<AdminPanelProps> = ({ employees, onRefresh }) => {
  const [adminTab, setAdminTab] = useState<'list' | 'org' | 'history'>('list');
  const [orgDisaster, setOrgDisaster] = useState<Disaster>('화재');
  const [filterCategory, setFilterCategory] = useState('전체');
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editEmpNo, setEditEmpNo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  // 재난편제표: 배지별 임무 미리보기 (임무 "내용"은 disa_app이 관리 — 여기선 동기화된 값을 조회만 함)
  const [orgRoles, setOrgRoles] = useState<(DisasterRole & { disaster_tasks: DisasterTask[] })[]>([]);
  const [previewBadge, setPreviewBadge] = useState<string | null>(null);
  // 재난편제표: 주/야 구분 — 2026-07-08부터 모든 재난에 적용 (배지·임무·배정 인원 모두 근무별로 다름)
  const [orgShift, setOrgShift] = useState<'day' | 'night'>('day');
  // 재난편제표: 배지별 배정 인원(emp_no) — 2026-07-05부터 여기서 직접 배정/해제
  const [badgeAssignments, setBadgeAssignments] = useState<Record<string, string[]>>({});
  // TTS 필수인원(emp_no) — 이 재난·근무에서 체크된 사람은 실제상황 발령 즉시(대기 없이) 전화(2026-07-24)
  const [ttsMustCallNos, setTtsMustCallNos] = useState<Set<string>>(new Set());
  const [addPickerBadge, setAddPickerBadge] = useState<string | null>(null);
  const [exportingOrg, setExportingOrg] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [bulkTeam, setBulkTeam] = useState('');
  const [badgeBusy, setBadgeBusy] = useState(false);
  // 직원목록 탭: 전 직원의 배지 배정 현황 (읽기전용 표시용)
  const [allEmployeeBadges, setAllEmployeeBadges] = useState<Record<string, Record<string, string>>>({});
  const refreshAllEmployeeBadges = () => {
    db.getAllEmployeeBadges().then(setAllEmployeeBadges).catch(() => setAllEmployeeBadges({}));
  };
  useEffect(() => { refreshAllEmployeeBadges(); }, []);
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

  // 재난·주야 선택 바뀌면 해당 근무의 역할·임무 + 배지별 배정 인원을 새로 조회
  const refreshBadgeAssignments = () => {
    db.getEmployeeBadgesByDisaster(orgDisaster, orgShift).then(setBadgeAssignments).catch(() => setBadgeAssignments({}));
    db.getTtsMustCallEmpNos(orgDisaster, orgShift).then(nos => setTtsMustCallNos(new Set(nos))).catch(() => setTtsMustCallNos(new Set()));
  };
  useEffect(() => {
    setPreviewBadge(null);
    setAddPickerBadge(null);
    const refresh = () => {
      db.getDisasterRolesWithTasks(orgDisaster, orgShift).then(setOrgRoles).catch(() => setOrgRoles([]));
      refreshBadgeAssignments();
    };
    refresh();

    // 재난대응메뉴얼(외부 앱)에서 이 재난의 역할·임무를 수정/삭제하면 실시간으로 반영
    const channel = supabase
      .channel(`admin-disaster-roles-${orgDisaster}-${orgShift}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disaster_roles' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disaster_tasks' }, refresh)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgDisaster, orgShift]);

  // 재난별 전체 조직도(그룹·역할·배지·담당 직원·임무) 엑셀 다운로드 — 현재 선택된 재난과 무관하게 전체 재난을 시트별로 뽑음
  const exportOrgToExcel = async () => {
    setExportingOrg(true);
    try {
      const wb = XLSX.utils.book_new();
      const HDR = ['그룹', '역할/담당', '배지', '담당 직원', '임무번호', '임무내용'];
      const COL_W = [{ wch: 14 }, { wch: 36 }, { wch: 8 }, { wch: 30 }, { wch: 8 }, { wch: 70 }];

      const buildSheet = async (disaster: Disaster, shift: 'day' | 'night', sheetName: string) => {
        const [roles, badgeMap] = await Promise.all([
          db.getDisasterRolesWithTasks(disaster, shift),
          db.getEmployeeBadgesByDisaster(disaster, shift),
        ]);
        if (roles.length === 0) return;

        const rows: (string | number)[][] = [HDR];
        roles.forEach(role => {
          const assignedNames = (badgeMap[role.badge] ?? [])
            .map(empNo => employees.find(e => e.emp_no === empNo)?.name ?? empNo)
            .join('·');
          const tasks = (role.disaster_tasks ?? []).slice().sort((a, b) => a.task_idx - b.task_idx);
          if (tasks.length === 0) {
            rows.push([role.group_name ?? '', role.role, role.badge, assignedNames, '', '']);
          } else {
            tasks.forEach((t, i) => {
              rows.push([role.group_name ?? '', role.role, role.badge, assignedNames, i + 1, t.label]);
            });
          }
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = COL_W;
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      };

      for (const d of ORG_DISASTER_ORDER) {
        await buildSheet(d, 'day', DISASTER_LABELS[d]);
      }
      // 화재 야간은 별도 시트 — 현재 야간 임무가 등록된 유일한 재난 (2026-07-08 기준)
      await buildSheet('화재', 'night', '화재_야간');

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `트윈타워_재난조직도_${today}.xlsx`);
    } catch (e) {
      alert('엑셀 생성 중 오류가 발생했습니다: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExportingOrg(false);
    }
  };

  const handleAssignBadge = async (empNo: string, badge: string) => {
    setBadgeBusy(true);
    try {
      await db.upsertEmployeeBadge(empNo, orgDisaster, badge, orgShift);
      refreshBadgeAssignments();
      refreshAllEmployeeBadges();
      setAddSearch('');
    } finally {
      setBadgeBusy(false);
    }
  };

  const handleToggleTtsMustCall = async (empNo: string, next: boolean) => {
    setBadgeBusy(true);
    try {
      await db.setTtsMustCall(empNo, orgDisaster, orgShift, next);
      refreshBadgeAssignments();
    } finally {
      setBadgeBusy(false);
    }
  };

  const handleUnassignBadge = async (empNo: string, empName: string) => {
    if (!window.confirm(`${empName}님을 이 배지에서 제거할까요?`)) return;
    setBadgeBusy(true);
    try {
      await db.deleteEmployeeBadge(empNo, orgDisaster, orgShift);
      refreshBadgeAssignments();
      refreshAllEmployeeBadges();
    } finally {
      setBadgeBusy(false);
    }
  };

  const handleBulkAssignTeam = async (team: string, badge: string) => {
    if (!team) return;
    setBadgeBusy(true);
    try {
      const teamEmps = employees.filter(e => e.team === team);
      for (const e of teamEmps) await db.upsertEmployeeBadge(e.emp_no, orgDisaster, badge, orgShift);
      refreshBadgeAssignments();
      refreshAllEmployeeBadges();
      setBulkTeam('');
    } finally {
      setBadgeBusy(false);
    }
  };

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
      // 재난 배지는 더 이상 팀 기준으로 자동 적용하지 않음 — "재난 편제표" 탭에서 배지별로
      // 인원을 직접 배정/해제하는 방식으로 전환(2026-07-05). 새 직원도 여기서 저장 후
      // 편제표 탭에서 배지를 배정해야 임무를 받습니다.

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
    background: '#f8fafc',
    border: '1px solid var(--border-glow)',
    borderRadius: '8px', color: 'var(--text-main)',
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
          background: 'rgba(11,37,69,0.55)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '420px', background: '#ffffff', borderRadius: '16px',
            border: '1px solid rgba(220,38,38,0.3)', padding: '24px',
            boxShadow: '0 20px 48px rgba(11,37,69,0.28)',
            display: 'flex', flexDirection: 'column', gap: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>🔒</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#b91c1c' }}>RLS 정책 오류</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Supabase SQL Editor에서 1회 실행 필요
                </div>
              </div>
              <button onClick={() => setRlsError(false)} style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{
              background: '#f1f4f9', borderRadius: '8px', border: '1px solid var(--border-glow)',
              padding: '12px 14px', fontFamily: 'monospace', fontSize: '12px', color: '#0369a1', lineHeight: 1.8,
            }}>
              {RLS_FIX_SQL.split('\n').map((line, i) => <div key={i}>{line}</div>)}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleCopySQL} style={{
                flex: 1, padding: '11px', borderRadius: '8px', cursor: 'pointer',
                background: copied ? 'rgba(15,157,99,0.12)' : 'rgba(37,99,235,0.1)',
                border: `1px solid ${copied ? 'rgba(15,157,99,0.4)' : 'rgba(37,99,235,0.4)'}`,
                color: copied ? '#0f9d63' : '#2563eb', fontSize: '13px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}>
                <Copy size={14} />{copied ? '복사 완료!' : 'SQL 복사'}
              </button>
              <button onClick={() => window.open(SUPABASE_SQL_URL, '_blank')} style={{
                flex: 1, padding: '11px', borderRadius: '8px', cursor: 'pointer',
                background: 'rgba(15,157,99,0.1)', border: '1px solid rgba(15,157,99,0.35)',
                color: '#0f9d63', fontSize: '13px', fontWeight: 700,
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
        <Users size={18} color="#2563eb" />
        <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0, flex: 1 }}>인원 관리</h2>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(11,37,69,0.06)', padding: '2px 8px', borderRadius: '6px' }}>
          총 {employees.length}명
        </span>
        {adminTab === 'list' && (
          <button onClick={openAdd} style={{
            display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px', cursor: 'pointer',
            background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.4)', color: '#2563eb', fontSize: '12px', fontWeight: 700,
          }}>
            <UserPlus size={14} />직원 추가
          </button>
        )}
      </div>

      {/* 탭 스위처 */}
      <div style={{ display: 'flex', background: '#eef1f6', border: '1px solid var(--border-glow)', borderRadius: '10px', padding: '3px', gap: '3px' }}>
        {([
          { key: 'list' as const, label: '👥 직원 목록' },
          { key: 'org'  as const, label: '🗂 재난 편제표' },
          { key: 'history' as const, label: '🗃 기타관리' },
        ]).map(tab => (
          <button key={tab.key} type="button" onClick={() => setAdminTab(tab.key)} style={{
            flex: 1, padding: '8px 0', fontSize: '12px', fontWeight: 700, cursor: 'pointer', borderRadius: '7px',
            background: adminTab === tab.key ? 'rgba(59,130,246,0.2)' : 'transparent',
            border: adminTab === tab.key ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
            color: adminTab === tab.key ? '#2563eb' : '#64748b',
            transition: 'all 0.15s',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── 편제표 탭: 좌측 재난 세로 메뉴 + 우측 배지별 인원배정 아코디언 ── */}
      {adminTab === 'org' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* 주간/야간 토글 */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['day', 'night'] as const).map(s => (
              <button key={s} type="button" onClick={() => setOrgShift(s)} style={{
                flex: 1, padding: '9px 0', borderRadius: '8px', cursor: 'pointer',
                fontSize: '13px', fontWeight: 700,
                background: orgShift === s ? 'rgba(59,130,246,0.2)' : 'rgba(11,37,69,0.05)',
                border: `1px solid ${orgShift === s ? 'rgba(59,130,246,0.5)' : 'rgba(11,37,69,0.12)'}`,
                color: orgShift === s ? '#2563eb' : 'var(--text-muted)',
              }}>
                {s === 'day' ? '☀️ 주간' : '🌙 야간'}
              </button>
            ))}
            <button type="button" onClick={exportOrgToExcel} disabled={exportingOrg} style={{
              display: 'flex', alignItems: 'center', gap: '5px', padding: '0 12px', borderRadius: '8px',
              fontSize: '12px', fontWeight: 700, cursor: exportingOrg ? 'default' : 'pointer',
              background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
              color: '#16a34a', opacity: exportingOrg ? 0.6 : 1, whiteSpace: 'nowrap',
            }}>
              <Download size={13} />{exportingOrg ? '생성 중...' : '전체 조직도 다운로드'}
            </button>
          </div>
          {orgShift === 'night' && (
            <div style={{ fontSize: '11px', color: '#64748b', padding: '6px 10px', background: 'rgba(11,37,69,0.04)', borderRadius: '8px' }}>
              📻 야간은 무전기 상시 휴대로 TTS 전화를 사용하지 않습니다 — 아래 "TTS 필수" 체크는 야간엔 무시됩니다.
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          {/* 좌측 세로 메뉴 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '76px', flexShrink: 0 }}>
            {ORG_DISASTER_ORDER.map(d => (
              <button key={d} type="button" onClick={() => setOrgDisaster(d)} style={{
                padding: '10px 4px', borderRadius: '8px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 700, textAlign: 'center',
                background: orgDisaster === d ? 'rgba(59,130,246,0.2)' : 'rgba(11,37,69,0.05)',
                border: `1px solid ${orgDisaster === d ? 'rgba(59,130,246,0.5)' : 'rgba(11,37,69,0.12)'}`,
                color: orgDisaster === d ? '#2563eb' : 'var(--text-muted)',
              }}>
                {DISASTER_LABELS[d]}
              </button>
            ))}
          </div>

          {/* 우측: 배지 목록 (클릭 → 배정 인원 + 인원추가 + 임무 미리보기) */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {orgRoles.length === 0 && (
              <div style={{ padding: '16px', fontSize: '12px', color: '#475569', textAlign: 'center' }}>
                이 재난·{orgShift === 'day' ? '주간' : '야간'}에 등록된 배지가 없습니다
                {orgShift === 'night' ? ' (야간 임무는 아직 화재만 있습니다 — 재난대응메뉴얼에서 다른 재난 야간 역할도 만들 수 있습니다).' : ' (재난대응메뉴얼에서 역할을 먼저 만들어야 합니다).'}
              </div>
            )}
            {orgRoles.map(role => {
              const color = role.bc || '#2563eb';
              const badge = role.badge;
              const assignedNos = badgeAssignments[badge] ?? [];
              const assignedEmps = assignedNos
                .map(no => employees.find(e => e.emp_no === no))
                .filter((e): e is EmployeeDB => !!e)
                .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
              const isOpen = previewBadge === badge;
              const isPicking = addPickerBadge === badge;
              const searchMatches = addSearch.trim()
                ? employees.filter(e =>
                    !assignedNos.includes(e.emp_no) &&
                    (e.name.includes(addSearch.trim()) || e.team.includes(addSearch.trim()))
                  ).slice(0, 8)
                : [];

              return (
                <div key={badge} style={{ border: `1px solid ${color}33`, borderRadius: '10px', overflow: 'hidden' }}>
                  <div onClick={() => setPreviewBadge(isOpen ? null : badge)} style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', cursor: 'pointer',
                    background: `${color}10`, borderBottom: isOpen ? `1px solid ${color}22` : 'none',
                  }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', fontWeight: 800, color, flex: 1 }}>{badge}</span>
                    <span style={{ fontSize: '10px', color: '#64748b' }}>{role.role}</span>
                    <span style={{ fontSize: '11px', color: color + 'aa', fontWeight: 600 }}>{assignedEmps.length}명</span>
                    <ChevronDown size={14} color={color}
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </div>
                  {isOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {/* 배정 인원 */}
                      {assignedEmps.length === 0 ? (
                        <div style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>배정된 인원이 없습니다.</div>
                      ) : (
                        assignedEmps.map(emp => {
                          const isMustCall = ttsMustCallNos.has(emp.emp_no);
                          return (
                            <div key={emp.emp_no} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', flex: 1 }}>{emp.name}</span>
                              <span style={{ fontSize: '11px', color: '#64748b' }}>{emp.team} · {emp.role}</span>
                              <label style={{
                                display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', flexShrink: 0,
                                padding: '2px 6px', borderRadius: '5px',
                                border: `1px solid ${isMustCall ? '#ef4444aa' : 'rgba(239,68,68,0.2)'}`,
                                background: isMustCall ? '#ef444422' : 'transparent',
                              }}>
                                <input
                                  type="checkbox"
                                  checked={isMustCall}
                                  disabled={badgeBusy}
                                  onChange={() => handleToggleTtsMustCall(emp.emp_no, !isMustCall)}
                                  style={{ width: '12px', height: '12px', accentColor: '#ef4444', cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: '9px', color: '#ef4444', fontWeight: 800 }}>TTS 필수</span>
                              </label>
                              <button type="button" disabled={badgeBusy} onClick={() => handleUnassignBadge(emp.emp_no, emp.name)} style={{
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                                borderRadius: '5px', color: '#ef4444', cursor: 'pointer', padding: '2px 7px', fontSize: '10px',
                              }}>
                                제거
                              </button>
                            </div>
                          );
                        })
                      )}

                      {/* 인원 추가 */}
                      <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(11,37,69,0.045)' }}>
                        {!isPicking ? (
                          <button type="button" onClick={() => { setAddPickerBadge(badge); setAddSearch(''); }} style={{
                            fontSize: '11px', color: '#2563eb', background: 'rgba(59,130,246,0.08)',
                            border: '1px solid rgba(59,130,246,0.25)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer',
                          }}>
                            + 인원 추가
                          </button>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <input
                              autoFocus type="text" placeholder="이름 또는 팀으로 검색"
                              value={addSearch} onChange={e => setAddSearch(e.target.value)}
                              style={{ ...inputStyle, padding: '6px 10px', fontSize: '12px' }}
                            />
                            {searchMatches.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '160px', overflowY: 'auto' }}>
                                {searchMatches.map(e => (
                                  <div key={e.emp_no} onClick={() => !badgeBusy && handleAssignBadge(e.emp_no, badge)} style={{
                                    display: 'flex', gap: '8px', padding: '5px 8px', borderRadius: '5px', cursor: 'pointer',
                                    background: 'rgba(11,37,69,0.035)',
                                  }}>
                                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', flex: 1 }}>{e.name}</span>
                                    <span style={{ fontSize: '11px', color: '#64748b' }}>{e.team}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <select value={bulkTeam} onChange={e => setBulkTeam(e.target.value)}
                                style={{ ...inputStyle, flex: 1, padding: '6px 8px', fontSize: '11px' }}>
                                <option value="">팀(파트) 전체 추가...</option>
                                {ALL_TEAMS.map(t => (
                                  <option key={t} value={t} style={{ background: '#f1f4f9', color: 'var(--text-main)' }}>{t}</option>
                                ))}
                              </select>
                              <button type="button" disabled={!bulkTeam || badgeBusy} onClick={() => handleBulkAssignTeam(bulkTeam, badge)} style={{
                                fontSize: '11px', color: '#0f9d63', background: 'rgba(16,185,129,0.08)',
                                border: '1px solid rgba(16,185,129,0.25)', borderRadius: '6px', padding: '0 10px',
                                cursor: bulkTeam ? 'pointer' : 'not-allowed', opacity: bulkTeam ? 1 : 0.5,
                              }}>
                                추가
                              </button>
                            </div>
                            <button type="button" onClick={() => setAddPickerBadge(null)} style={{
                              fontSize: '11px', color: '#64748b', background: 'transparent', border: 'none', cursor: 'pointer', alignSelf: 'flex-start',
                            }}>
                              닫기
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 임무 미리보기 (재난대응메뉴얼 동기화 내용, 읽기전용) */}
                      <div style={{ margin: '0 14px 10px', padding: '8px 10px', borderRadius: '8px', background: 'rgba(11,37,69,0.03)', border: `1px solid ${color}22` }}>
                        {!role.disaster_tasks?.length ? (
                          <div style={{ fontSize: '11px', color: '#64748b' }}>이 배지의 임무 내용이 없습니다 (재난대응메뉴얼에서 등록 필요).</div>
                        ) : (
                          <>
                            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '5px' }}>
                              {role.role} · 재난대응메뉴얼 기준 (읽기전용)
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              {role.disaster_tasks
                                .slice()
                                .sort((a, b) => a.task_idx - b.task_idx)
                                .map(t => (
                                  <div key={t.id} style={{ fontSize: '11.5px', color: t.label.startsWith('◇') || t.label.startsWith('◆') ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: t.label.startsWith('◇') || t.label.startsWith('◆') ? 700 : 400, paddingLeft: t.label.startsWith('┖') || t.label.startsWith('└') ? '12px' : '0' }}>
                                    {t.label}
                                  </div>
                                ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
                background: filterCategory === cat.label ? 'rgba(59,130,246,0.2)' : 'rgba(11,37,69,0.05)',
                border: `1px solid ${filterCategory === cat.label ? 'rgba(59,130,246,0.5)' : 'rgba(11,37,69,0.12)'}`,
                color: filterCategory === cat.label ? '#2563eb' : 'var(--text-muted)',
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
              style={{ ...inputStyle, padding: '10px 14px', background: 'rgba(11,37,69,0.045)', border: '1px solid rgba(11,37,69,0.1)' }}
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
                      borderBottom: expandedDept === dept.label ? '1px solid rgba(11,37,69,0.06)' : 'none',
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
                              <div style={{ padding: '6px 14px 5px', fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', background: 'rgba(11,37,69,0.035)' }}>
                                {sg.shift === '기타' ? '기타' : `${sg.shift}조`} · {sg.emps.length}명
                              </div>
                              {sg.emps.map(emp => <EmpRow key={emp.emp_no} emp={emp} badgeMap={allEmployeeBadges[emp.emp_no] ?? {}} onEdit={openEdit} onDelete={handleDelete} />)}
                            </div>
                          ))
                        ) : (
                          dept.emps.map(emp => <EmpRow key={emp.emp_no} emp={emp} badgeMap={allEmployeeBadges[emp.emp_no] ?? {}} onEdit={openEdit} onDelete={handleDelete} />)
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

      {/* ── 기타관리 탭: 종료 재난 기록 열람 (2026-07-29, 지휘본부 발령 화면에서 이전) ── */}
      {adminTab === 'history' && (
        <IncidentHistoryPanel employees={employees} />
      )}

      {/* ── 추가/편집 모달 ── */}
      {modalMode && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(11,37,69,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setModalMode(null); }}
        >
          <div style={{
            width: '100%', maxHeight: '90vh', background: '#ffffff',
            borderRadius: '20px 20px 0 0', border: '1px solid rgba(11,37,69,0.12)',
            boxShadow: '0 -8px 32px rgba(11,37,69,0.22)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* 모달 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 18px', borderBottom: '1px solid rgba(11,37,69,0.06)', flexShrink: 0 }}>
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
                    <option key={t} value={t} style={{ background: '#f1f4f9', color: 'var(--text-main)' }}>{t}</option>
                  ))}
                </select>
              </div>

              {/* 재난 배지 안내 — 배지는 여기서 자동 적용되지 않고 "재난 편제표" 탭에서 개별 배정 */}
              <div style={{ fontSize: '11px', color: '#64748b', padding: '6px 0' }}>
                ℹ️ 재난 배지는 여기서 자동 적용되지 않습니다. 저장 후 <b>재난 편제표</b> 탭에서 배지별로 직접 배정해주세요.
              </div>

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
                  전화번호 <span style={{ color: '#b45309', fontWeight: 500, textTransform: 'none' }}>* 뒤 4자리 = 로그인 비밀번호</span>
                </label>
                <input style={inputStyle} type="tel" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                  placeholder="숫자만 입력" />
                {form.phone.replace(/\D/g, '').length >= 4 && (
                  <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    로그인 비밀번호: <strong style={{ color: '#b45309' }}>{form.phone.replace(/\D/g, '').slice(-4)}</strong>
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
                    background: 'rgba(11,37,69,0.045)', border: '1px solid rgba(11,37,69,0.14)',
                    borderLeft: 'none', borderRadius: '0 8px 8px 0',
                    color: '#64748b', fontSize: '12px', display: 'flex', alignItems: 'center',
                  }}>@sni.co.kr</span>
                </div>
              </div>

              {/* 지휘관 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'rgba(11,37,69,0.035)', borderRadius: '8px' }}>
                <input type="checkbox" id="is_commander_chk" checked={form.is_commander}
                  onChange={e => setForm(f => ({ ...f, is_commander: e.target.checked }))}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <label htmlFor="is_commander_chk" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: form.is_commander ? '#2563eb' : 'var(--text-muted)' }}>
                  지휘관 권한 부여 (발령·종료 기능 접근 가능)
                </label>
              </div>
            </div>

            {/* 저장 버튼 */}
            <div style={{ padding: '12px 18px 20px', flexShrink: 0, borderTop: '1px solid rgba(11,37,69,0.06)' }}>
              <button onClick={handleSave} disabled={saving} style={{
                width: '100%', padding: '13px', borderRadius: '10px',
                cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)',
                border: '1px solid rgba(59,130,246,0.5)', color: '#2563eb',
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
  badgeMap: Record<string, string>;
  onEdit: (emp: EmployeeDB) => void;
  onDelete: (emp: EmployeeDB) => void;
}> = ({ emp, badgeMap, onEdit, onDelete }) => {
  const lastFour = emp.phone?.replace(/\D/g, '').slice(-4) ?? '—';
  // 직원목록은 주간 배지만 표시 (야간 배정은 재난편제표 탭에서 확인)
  const badges = useMemo(
    () => ALL_DISASTERS.filter(d => badgeMap[`${d}|day`]).map(d => ({ disaster: d, badge: badgeMap[`${d}|day`] })),
    [badgeMap]
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', borderBottom: '1px solid rgba(11,37,69,0.045)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700 }}>{emp.name}</span>
          {emp.role.includes('조장') && (
            <span style={{ fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', background: 'rgba(251,191,36,0.15)', color: '#b45309', border: '1px solid rgba(251,191,36,0.3)' }}>조장</span>
          )}
          {emp.is_commander && (
            <span style={{ fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', background: 'rgba(59,130,246,0.2)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.3)' }}>지휘관</span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {emp.team} · {emp.role}
          {emp.phone && <span style={{ marginLeft: '8px', color: '#475569' }}>🔑 {lastFour}</span>}
        </div>
        {badges.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '5px' }}>
            {badges.map(({ disaster, badge }) => (
              <span key={disaster} title={`${disaster} 발령 시 배지`} style={{
                fontSize: '9.5px', padding: '1px 6px', borderRadius: '4px',
                background: 'rgba(96,165,250,0.08)', color: '#1d4ed8',
                border: '1px solid rgba(96,165,250,0.18)', whiteSpace: 'nowrap',
              }}>
                {DISASTER_LABELS[disaster]}·{badge}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '9.5px', color: '#475569', marginTop: '5px' }}>재난 배지 매핑 없음</div>
        )}
      </div>
      <button onClick={() => onEdit(emp)} style={{ background: 'rgba(11,37,69,0.05)', border: '1px solid rgba(11,37,69,0.12)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '5px 8px' }}>
        <Pencil size={13} />
      </button>
      <button onClick={() => onDelete(emp)} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', padding: '5px 8px' }}>
        <Trash2 size={13} />
      </button>
    </div>
  );
};
