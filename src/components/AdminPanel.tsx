import React, { useEffect, useState, useMemo } from 'react';
import { db, type EmployeeDB } from '../services/supabase';
import { UserPlus, Pencil, Trash2, X, Save, Users, ChevronDown } from 'lucide-react';

const ALL_TEAMS = [
  '센터장', '상황실',
  '기계파트', '전기파트', '소방파트',
  '운영파트', '건축파트', '품질/안전파트',
  '보안1', '보안2', '보안3',
  '주차파트', '미화파트',
];

const DISASTERS_LIST = [
  { key: '화재', icon: '🔥' },
  { key: '정전', icon: '⚡' },
  { key: '누수', icon: '💧' },
  { key: '태풍/홍수', icon: '🌀' },
  { key: '폭설', icon: '❄️' },
  { key: '지진', icon: '🌍' },
  { key: '가스누출', icon: '💨' },
  { key: '승강기', icon: '🛗' },
  { key: '테러', icon: '🚨' },
];

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
  emp_no: '', name: '', team: ALL_TEAMS[0], role: '파트원',
  is_commander: false, phone: '', email: '',
};

interface AdminPanelProps {
  employees: EmployeeDB[];
  onRefresh: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ employees, onRefresh }) => {
  const [filterTeam, setFilterTeam] = useState('전체');
  const [search, setSearch] = useState('');
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [modalTab, setModalTab] = useState<'info' | 'badge'>('info');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editEmpNo, setEditEmpNo] = useState<string | null>(null);
  const [formBadges, setFormBadges] = useState<Record<string, string>>({});
  const [badgeOptions, setBadgeOptions] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  // 재난별 배지 목록 한 번만 로드
  useEffect(() => {
    db.getAllDisasterBadgeOptions().then(setBadgeOptions).catch(console.error);
  }, []);

  // 팀 목록 (실제 DB 기준)
  const teamList = useMemo(() => {
    const teamSet = new Set(employees.map(e => e.team));
    return ['전체', ...ALL_TEAMS.filter(t => teamSet.has(t)), ...Array.from(teamSet).filter(t => !ALL_TEAMS.includes(t)).sort()];
  }, [employees]);

  // 필터링
  const filtered = useMemo(() => {
    let list = employees;
    if (filterTeam !== '전체') list = list.filter(e => e.team === filterTeam);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e => e.name.includes(q) || e.role.toLowerCase().includes(q) || e.emp_no.includes(q));
    }
    return [...list].sort((a, b) => a.team.localeCompare(b.team, 'ko') || a.name.localeCompare(b.name, 'ko'));
  }, [employees, filterTeam, search]);

  // 팀별 그룹화
  const grouped = useMemo(() => {
    const map: Record<string, EmployeeDB[]> = {};
    for (const e of filtered) {
      (map[e.team] ??= []).push(e);
    }
    return map;
  }, [filtered]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setFormBadges({});
    setModalTab('info');
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
    if (!form.emp_no.trim()) return alert('사번을 입력하세요.');
    if (!form.name.trim()) return alert('이름을 입력하세요.');
    if (!form.phone.trim()) return alert('전화번호를 입력하세요 (로그인 비밀번호로 사용).');

    setSaving(true);
    try {
      const empData: EmployeeDB = {
        emp_no: form.emp_no.trim(),
        name: form.name.trim(),
        team: form.team,
        role: form.role.trim(),
        is_commander: form.is_commander,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
      };

      if (modalMode === 'add') {
        await db.addEmployee(empData);
      } else if (modalMode === 'edit' && editEmpNo) {
        await db.updateEmployee(editEmpNo, empData);
      }

      // 배지 저장 (편집 모드에서만, 추가 시에는 배지 탭에서 별도 저장)
      if (modalMode === 'edit' && editEmpNo) {
        for (const { key: disaster } of DISASTERS_LIST) {
          const badge = formBadges[disaster];
          if (badge) {
            await db.upsertEmployeeBadge(editEmpNo, disaster, badge);
          } else {
            try { await db.deleteEmployeeBadge(editEmpNo, disaster); } catch { /* 없으면 무시 */ }
          }
        }
      } else if (modalMode === 'add') {
        // 추가 시 배지도 함께 저장
        for (const { key: disaster } of DISASTERS_LIST) {
          const badge = formBadges[disaster];
          if (badge) await db.upsertEmployeeBadge(form.emp_no.trim(), disaster, badge);
        }
      }

      setModalMode(null);
      onRefresh();
    } catch (err: any) {
      alert('저장 실패: ' + (err.message ?? err));
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
      alert('삭제 실패: ' + (err.message ?? err));
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px',
    background: 'rgba(255,255,255,0.06)',
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

  return (
    <div className="content" style={{ gap: '12px' }}>
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
        placeholder="이름 · 사번 · 역할 검색"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{
          ...inputStyle,
          padding: '10px 14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.09)',
        }}
      />

      {/* 팀 필터 */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
        {teamList.map(t => (
          <button key={t} onClick={() => setFilterTeam(t)} style={{
            flexShrink: 0, padding: '5px 12px', borderRadius: '20px', cursor: 'pointer',
            fontSize: '12px', fontWeight: 700,
            background: filterTeam === t ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${filterTeam === t ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
            color: filterTeam === t ? '#60a5fa' : 'var(--text-muted)',
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* 직원 목록 */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
          {search ? '검색 결과가 없습니다.' : '등록된 직원이 없습니다.'}
        </div>
      ) : (
        filterTeam === '전체' ? (
          // 팀별 그룹 아코디언
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
        ) : (
          // 단일 팀 — 바로 목록
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {filtered.map(emp => <EmpRow key={emp.emp_no} emp={emp} onEdit={openEdit} onDelete={handleDelete} />)}
          </div>
        )
      )}

      {/* ── 추가/편집 모달 ── */}
      {modalMode && (
        <div style={{
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
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: '2px',
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>사번 {modalMode === 'edit' && <span style={{ color: '#475569' }}>(변경불가)</span>}</label>
                      <input style={{ ...inputStyle, opacity: modalMode === 'edit' ? 0.5 : 1 }}
                        value={form.emp_no}
                        onChange={e => setForm(f => ({ ...f, emp_no: e.target.value }))}
                        readOnly={modalMode === 'edit'}
                        placeholder="예: E001"
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>이름</label>
                      <input style={inputStyle}
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="홍길동"
                      />
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>파트 (팀)</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }}
                      value={form.team}
                      onChange={e => setForm(f => ({ ...f, team: e.target.value }))}>
                      {ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>역할</label>
                    <input style={inputStyle}
                      value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                      placeholder="파트장 / 파트원 / 파트원(A조 교대) 등"
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>전화번호 <span style={{ color: '#f59e0b', fontWeight: 500 }}>* 뒤 4자리 = 로그인 비밀번호</span></label>
                    <input style={inputStyle}
                      type="tel"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="01012345678"
                    />
                    {form.phone && (
                      <div style={{ marginTop: '5px', fontSize: '11px', color: '#94a3b8' }}>
                        로그인 비밀번호: <strong style={{ color: '#fbbf24' }}>
                          {form.phone.replace(/\D/g, '').slice(-4) || '—'}
                        </strong>
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={labelStyle}>이메일 (선택)</label>
                    <input style={inputStyle}
                      type="email"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="hong@example.com"
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                    <input type="checkbox" id="is_commander_chk"
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
                              background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(255,255,255,0.15)',
                              color: current ? '#60a5fa' : '#475569', cursor: 'pointer', outline: 'none',
                              minWidth: '80px',
                            }}
                          >
                            <option value="">없음</option>
                            {options.map(b => <option key={b} value={b}>{b}</option>)}
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
              <button onClick={handleSave} disabled={saving} style={{
                width: '100%', padding: '13px', borderRadius: '10px', cursor: saving ? 'not-allowed' : 'pointer',
                background: saving ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)',
                border: '1px solid rgba(59,130,246,0.5)', color: '#60a5fa',
                fontSize: '14px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
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
