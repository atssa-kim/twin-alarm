import React, { useEffect, useState, useMemo } from 'react';
import { db, type EmployeeDB } from '../services/supabase';
import { UserPlus, Pencil, Trash2, X, Save, Users, ChevronDown, Copy, ExternalLink } from 'lucide-react';

const RLS_FIX_SQL =
  `ALTER TABLE employees DISABLE ROW LEVEL SECURITY;\nALTER TABLE employee_disaster_badges DISABLE ROW LEVEL SECURITY;`;

const SUPABASE_SQL_URL = 'https://supabase.com/dashboard/project/hzqesdprnlpzaomaeswx/sql/new';

const ALL_TEAMS = [
  '센터장', '상황실',
  '운영파트', '건축파트',
  '기계파트', '전기파트', '소방파트', '품질/안전파트',
  '보안1', '보안2', '보안3',
  '주차파트', '미화파트',
];

// 카테고리별 팀 그룹핑 (필터 탭)
const TEAM_CATEGORIES: { label: string; teams: string[] | null }[] = [
  { label: '전체',   teams: null },
  { label: '운영',   teams: ['센터장', '상황실', '운영파트', '건축파트'] },
  { label: '기계',   teams: ['기계파트'] },
  { label: '전기',   teams: ['전기파트'] },
  { label: '소방',   teams: ['소방파트'] },
  { label: '안전',   teams: ['품질/안전파트'] },
  { label: '협력',   teams: ['보안1', '보안2', '보안3', '보안파트', '주차파트', '미화파트'] },
];

const DISASTERS_LIST = [
  { key: '화재',    icon: '🔥' },
  { key: '정전',    icon: '⚡' },
  { key: '누수',    icon: '💧' },
  { key: '태풍/홍수', icon: '🌀' },
  { key: '폭설',    icon: '❄️' },
  { key: '지진',    icon: '🌍' },
  { key: '가스누출', icon: '💨' },
  { key: '승강기',  icon: '🛗' },
  { key: '테러',    icon: '🚨' },
];

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
  is_commander: false, phone: '010-', email: '',
};

interface AdminPanelProps {
  employees: EmployeeDB[];
  onRefresh: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ employees, onRefresh }) => {
  const [filterCategory, setFilterCategory] = useState('전체');
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [modalTab, setModalTab] = useState<'info' | 'badge'>('info');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editEmpNo, setEditEmpNo] = useState<string | null>(null);
  const [formBadges, setFormBadges] = useState<Record<string, string>>({});
  const [badgeOptions, setBadgeOptions] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [rlsError, setRlsError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    db.getAllDisasterBadgeOptions().then(setBadgeOptions).catch(console.error);
  }, []);

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

  const grouped = useMemo(() => {
    const map: Record<string, EmployeeDB[]> = {};
    for (const e of filtered) (map[e.team] ??= []).push(e);
    return map;
  }, [filtered]);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, emp_no: generateEmpNo() });
    setFormBadges({});
    setModalTab('info');
    setEditEmpNo(null);
    setModalMode('add');
  };

  const openEdit = async (emp: EmployeeDB) => {
    setForm({
      emp_no: emp.emp_no, name: emp.name, team: emp.team,
      role: emp.role, is_commander: emp.is_commander,
      phone: emp.phone ?? '010-', email: emp.email ?? '',
    });
    setEditEmpNo(emp.emp_no);
    setModalTab('info');
    setModalMode('edit');
    try {
      const badges = await db.getEmployeeAllBadges(emp.emp_no);
      setFormBadges(badges);
    } catch {
      setFormBadges({});
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('이름을 입력하세요.');
    const rawPhone = form.phone.trim();
    if (!rawPhone || rawPhone === '010-') return alert('전화번호를 입력하세요 (로그인 비밀번호로 사용).');

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
        phone: rawPhone,
        email: finalEmail,
      };

      if (modalMode === 'add') {
        await db.addEmployee(empData);
        for (const { key: disaster } of DISASTERS_LIST) {
          const badge = formBadges[disaster];
          if (badge) await db.upsertEmployeeBadge(empNo, disaster, badge);
        }
      } else if (modalMode === 'edit' && editEmpNo) {
        await db.updateEmployee(editEmpNo, empData);
        for (const { key: disaster } of DISASTERS_LIST) {
          const badge = formBadges[disaster];
          if (badge) {
            await db.upsertEmployeeBadge(editEmpNo, disaster, badge);
          } else {
            try { await db.deleteEmployeeBadge(editEmpNo, disaster); } catch { /* 없으면 무시 */ }
          }
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
    if (!window.confirm(`[${emp.name}] 직원을 삭제하시겠습니까?\n삭제 시 재난 배지 정보도 함께 삭제됩니다.`)) return;
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

  const teamGroups = Object.entries(grouped);

  const handleCopySQL = () => {
    navigator.clipboard.writeText(RLS_FIX_SQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="content" style={{ gap: '12px' }}>

      {/* RLS 오류 안내 모달 */}
      {rlsError && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '420px',
            background: '#0f172a', borderRadius: '16px',
            border: '1px solid rgba(239,68,68,0.4)',
            padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>🔒</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#fca5a5' }}>RLS 정책 오류</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                  Supabase SQL Editor에서 1회 실행이 필요합니다
                </div>
              </div>
              <button onClick={() => setRlsError(false)} style={{
                background: 'transparent', border: 'none', color: '#475569',
                cursor: 'pointer', padding: '2px',
              }}>
                <X size={18} />
              </button>
            </div>

            <div style={{
              background: 'rgba(0,0,0,0.4)', borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '12px 14px', fontFamily: 'monospace', fontSize: '12px',
              color: '#7dd3fc', lineHeight: 1.8,
              userSelect: 'all',
            }}>
              {RLS_FIX_SQL.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleCopySQL} style={{
                flex: 1, padding: '11px', borderRadius: '8px', cursor: 'pointer',
                background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)',
                border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'rgba(59,130,246,0.4)'}`,
                color: copied ? '#34d399' : '#60a5fa',
                fontSize: '13px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}>
                <Copy size={14} />
                {copied ? '복사 완료!' : 'SQL 복사'}
              </button>
              <button onClick={() => window.open(SUPABASE_SQL_URL, '_blank')} style={{
                flex: 1, padding: '11px', borderRadius: '8px', cursor: 'pointer',
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.35)',
                color: '#34d399',
                fontSize: '13px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}>
                <ExternalLink size={14} />
                Supabase 열기
              </button>
            </div>

            <div style={{ fontSize: '11px', color: '#475569', textAlign: 'center', lineHeight: 1.6 }}>
              SQL 복사 → Supabase 열기 → SQL Editor에 붙여넣기 → Run
            </div>
          </div>
        </div>
      )}
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Users size={18} color="#60a5fa" />
        <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0, flex: 1 }}>인원 관리</h2>
        <span style={{
          fontSize: '11px', color: 'var(--text-muted)',
          background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '6px',
        }}>
          총 {employees.length}명
        </span>
        <button
          onClick={openAdd}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '7px 12px', borderRadius: '8px', cursor: 'pointer',
            background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
            color: '#60a5fa', fontSize: '12px', fontWeight: 700,
          }}
        >
          <UserPlus size={14} />
          직원 추가
        </button>
      </div>

      {/* 검색 */}
      <input
        type="text"
        placeholder="이름 · 역할 검색"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ ...inputStyle, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
      />

      {/* 카테고리 필터 */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
        {TEAM_CATEGORIES.map(cat => (
          <button
            key={cat.label}
            onClick={() => { setFilterCategory(cat.label); setExpandedTeam(null); }}
            style={{
              flexShrink: 0, padding: '5px 12px', borderRadius: '20px', cursor: 'pointer',
              fontSize: '12px', fontWeight: 700,
              background: filterCategory === cat.label ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${filterCategory === cat.label ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
              color: filterCategory === cat.label ? '#60a5fa' : 'var(--text-muted)',
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* 직원 목록 — 팀별 아코디언 */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
          {search ? '검색 결과가 없습니다.' : '등록된 직원이 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {teamGroups.map(([team, emps]) => (
            <div key={team} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                className="accordion-header"
                onClick={() => setExpandedTeam(expandedTeam === team ? null : team)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '11px 14px',
                  borderBottom: expandedTeam === team ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 800, flex: 1 }}>{team}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{emps.length}명</span>
                <ChevronDown size={14} color="var(--text-muted)"
                  style={{ transform: expandedTeam === team ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </div>
              {expandedTeam === team && (
                <div>
                  {emps.map(emp => <EmpRow key={emp.emp_no} emp={emp} onEdit={openEdit} onDelete={handleDelete} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 추가/편집 모달 ── */}
      {modalMode && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-end',
          }}
          onClick={e => { if (e.target === e.currentTarget) setModalMode(null); }}
        >
          <div style={{
            width: '100%', maxHeight: '90vh',
            background: '#0f172a', borderRadius: '20px 20px 0 0',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* 모달 헤더 */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: '15px', fontWeight: 800, flex: 1 }}>
                {modalMode === 'add' ? '직원 추가' : '직원 수정'}
              </span>
              <button onClick={() => setModalMode(null)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px',
              }}>
                <X size={20} />
              </button>
            </div>

            {/* 탭 */}
            <div className="segmented-control" style={{ margin: '12px 18px 0', flexShrink: 0 }}>
              <button className={`segmented-btn${modalTab === 'info' ? ' active' : ''}`}
                onClick={() => setModalTab('info')}>기본 정보</button>
              <button className={`segmented-btn${modalTab === 'badge' ? ' active' : ''}`}
                onClick={() => setModalTab('badge')}>재난 배지</button>
            </div>

            {/* 스크롤 영역 */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {modalTab === 'info' ? (
                <>
                  {/* 이름 + 사번(자동) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>이름</label>
                      <input
                        style={inputStyle}
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="홍길동"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>사번 (자동)</label>
                      <input
                        style={{ ...inputStyle, opacity: 0.35, fontSize: '10px', color: '#64748b' }}
                        value={form.emp_no}
                        readOnly
                      />
                    </div>
                  </div>

                  {/* 파트 */}
                  <div>
                    <label style={labelStyle}>파트 (팀)</label>
                    <select
                      style={{ ...inputStyle, cursor: 'pointer', background: '#1e293b', color: '#e2e8f0' }}
                      value={form.team}
                      onChange={e => setForm(f => ({ ...f, team: e.target.value }))}
                    >
                      {ALL_TEAMS.map(t => (
                        <option key={t} value={t} style={{ background: '#1e293b', color: '#e2e8f0' }}>{t}</option>
                      ))}
                    </select>
                  </div>

                  {/* 역할 */}
                  <div>
                    <label style={labelStyle}>역할</label>
                    <input
                      style={inputStyle}
                      value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                      placeholder="파트장 / 파트원 / 파트원(A조 교대) 등"
                    />
                  </div>

                  {/* 전화번호 */}
                  <div>
                    <label style={labelStyle}>
                      전화번호{' '}
                      <span style={{ color: '#f59e0b', fontWeight: 500, textTransform: 'none' }}>
                        * 뒤 4자리 = 로그인 비밀번호
                      </span>
                    </label>
                    <input
                      style={inputStyle}
                      type="tel"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="010-0000-0000"
                    />
                    {form.phone && form.phone !== '010-' && (
                      <div style={{ marginTop: '5px', fontSize: '11px', color: '#94a3b8' }}>
                        로그인 비밀번호:{' '}
                        <strong style={{ color: '#fbbf24' }}>
                          {form.phone.replace(/\D/g, '').slice(-4) || '—'}
                        </strong>
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
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.12)', borderLeft: 'none',
                        borderRadius: '0 8px 8px 0',
                        color: '#64748b', fontSize: '12px',
                        display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
                      }}>
                        @sni.co.kr
                      </span>
                    </div>
                  </div>

                  {/* 지휘관 체크 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                    <input
                      type="checkbox"
                      id="is_commander_chk"
                      checked={form.is_commander}
                      onChange={e => setForm(f => ({ ...f, is_commander: e.target.checked }))}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    <label htmlFor="is_commander_chk" style={{ fontSize: '13px', fontWeight: 600, cursor: 'pointer', color: form.is_commander ? '#60a5fa' : '#94a3b8' }}>
                      지휘관 권한 부여 (발령·종료 기능 접근 가능)
                    </label>
                  </div>
                </>
              ) : (
                /* 재난 배지 탭 */
                <>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    재난 발령 시 이 직원에게 할당될 역할(배지)을 설정합니다.<br />
                    배지가 없으면 해당 재난에서 임무 체크리스트가 표시되지 않습니다.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {DISASTERS_LIST.map(({ key, icon }) => {
                      const options = badgeOptions[key] ?? [];
                      const current = formBadges[key] ?? '';
                      return (
                        <div key={key} style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '9px 12px', borderRadius: '8px',
                          background: current ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${current ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.06)'}`,
                        }}>
                          <span style={{ fontSize: '17px', flexShrink: 0 }}>{icon}</span>
                          <span style={{ fontSize: '12px', fontWeight: 700, flex: 1, color: current ? '#e2e8f0' : '#64748b' }}>{key}</span>
                          <select
                            value={current}
                            onChange={e => setFormBadges(prev => ({ ...prev, [key]: e.target.value }))}
                            style={{
                              padding: '5px 8px', borderRadius: '6px', fontSize: '12px',
                              background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
                              color: current ? '#60a5fa' : '#94a3b8',
                              cursor: 'pointer', outline: 'none', minWidth: '80px',
                            }}
                          >
                            <option value="" style={{ background: '#1e293b', color: '#64748b' }}>없음</option>
                            {options.map(b => (
                              <option key={b} value={b} style={{ background: '#1e293b', color: '#e2e8f0' }}>{b}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 저장 버튼 */}
            <div style={{ padding: '12px 18px 20px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  width: '100%', padding: '13px', borderRadius: '10px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  background: saving ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)',
                  border: '1px solid rgba(59,130,246,0.5)', color: '#60a5fa',
                  fontSize: '14px', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                }}
              >
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '11px 14px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700 }}>{emp.name}</span>
          {emp.is_commander && (
            <span style={{
              fontSize: '9px', fontWeight: 800,
              padding: '1px 5px', borderRadius: '4px',
              background: 'rgba(59,130,246,0.2)', color: '#60a5fa',
              border: '1px solid rgba(59,130,246,0.3)',
            }}>지휘관</span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {emp.role}
          {emp.phone && <span style={{ marginLeft: '8px', color: '#475569' }}>🔑 {lastFour}</span>}
        </div>
      </div>
      <button onClick={() => onEdit(emp)} style={{
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '6px', color: '#94a3b8', cursor: 'pointer', padding: '5px 8px',
      }}>
        <Pencil size={13} />
      </button>
      <button onClick={() => onDelete(emp)} style={{
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: '6px', color: '#ef4444', cursor: 'pointer', padding: '5px 8px',
      }}>
        <Trash2 size={13} />
      </button>
    </div>
  );
};
