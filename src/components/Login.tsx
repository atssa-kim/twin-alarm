import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ShieldCheck, ChevronDown, Check } from 'lucide-react';
import { type EmployeeDB } from '../services/supabase';

const normalizeTeam = (team: string): string => {
  if (team.startsWith('보안')) return '보안파트';
  if (team.endsWith('파트장')) return team.replace('파트장', '파트');
  return team;
};

const getRoleRank = (role: string): number => {
  if (role.startsWith('파트장')) return 0;
  if (role === '파트원') return 1;
  if (role.startsWith('파트원')) return 2;
  return 3;
};

const getShiftRank = (role: string): number => {
  const m = role.match(/([A-D])조/);
  if (!m) return 9;
  return ['A', 'B', 'C', 'D'].indexOf(m[1]);
};

const TEAM_ORDER = [
  '상황실', '교대근무자', '센터장', '기계파트', '전기파트', '소방파트', '운영파트',
  '건축파트', '보안파트', '주차파트', '미화파트', '품질/안전파트',
];

export interface Employee {
  empNo: string;
  name: string;
  team: string;
  role: string;
  badge?: string;
  isCommander: boolean;
}

interface LoginProps {
  onLogin: (user: Employee) => void;
  employees: EmployeeDB[];
}

// ── 커스텀 드롭다운 컴포넌트 ─────────────────────────────────────────────
interface DropdownProps {
  placeholder: string;
  value: string;
  displayLabel?: string;
  disabled?: boolean;
  options: { value: string; label: string; sub?: string }[];
  onChange: (value: string) => void;
  color?: string;
}

const Dropdown: React.FC<DropdownProps> = ({
  placeholder, value, displayLabel, disabled, options, onChange, color = '#3b82f6'
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // 드롭다운 열릴 때 선택된 항목으로 스크롤
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && value && listRef.current) {
      const sel = listRef.current.querySelector('[data-selected="true"]') as HTMLElement;
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
  }, [open, value]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {/* 트리거 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px', padding: '13px 16px', borderRadius: '12px',
          background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)',
          border: open
            ? `1.5px solid ${color}`
            : '1.5px solid rgba(255,255,255,0.12)',
          color: value ? '#f1f5f9' : '#64748b',
          fontSize: '14px', fontWeight: value ? 600 : 400,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s', boxSizing: 'border-box',
          opacity: disabled ? 0.45 : 1,
          boxShadow: open ? `0 0 0 3px ${color}33` : 'none',
        }}
      >
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel || selected?.label || placeholder}
        </span>
        <ChevronDown
          size={16}
          color="#64748b"
          style={{ flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* 드롭다운 리스트 */}
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            zIndex: 200, borderRadius: '12px',
            background: '#1e293b',
            border: `1.5px solid ${color}55`,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            maxHeight: '220px', overflowY: 'auto',
          }}
        >
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                data-selected={isSelected}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '11px 14px', border: 'none', cursor: 'pointer',
                  background: isSelected ? `${color}22` : 'transparent',
                  textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px', fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? '#f1f5f9' : '#cbd5e1',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {opt.label}
                  </div>
                  {opt.sub && (
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>{opt.sub}</div>
                  )}
                </div>
                {isSelected && <Check size={14} color={color} style={{ flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── 로그인 메인 컴포넌트 ─────────────────────────────────────────────────
export const Login: React.FC<LoginProps> = ({ onLogin, employees }) => {
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedEmpNo, setSelectedEmpNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const teams = useMemo(() => {
    const teamSet = new Set<string>();
    for (const e of employees) {
      if (e.role.includes('교대')) {
        if (e.role.includes('방재')) teamSet.add('상황실');
        teamSet.add('교대근무자');
      } else {
        teamSet.add(normalizeTeam(e.team));
      }
    }
    return Array.from(teamSet).sort((a, b) => {
      const ia = TEAM_ORDER.indexOf(a);
      const ib = TEAM_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, 'ko');
    });
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!selectedTeam) return [];
    if (selectedTeam === '상황실') {
      return employees
        .filter(e => e.role.includes('교대') && e.role.includes('방재'))
        .sort((a, b) => getShiftRank(a.role) - getShiftRank(b.role) || a.name.localeCompare(b.name, 'ko'));
    }
    if (selectedTeam === '교대근무자') {
      return employees
        .filter(e => e.role.includes('교대'))
        .sort((a, b) => getShiftRank(a.role) - getShiftRank(b.role) || a.name.localeCompare(b.name, 'ko'));
    }
    return employees
      .filter(e => normalizeTeam(e.team) === selectedTeam && !e.role.includes('교대'))
      .sort((a, b) => getRoleRank(a.role) - getRoleRank(b.role) || a.name.localeCompare(b.name, 'ko'));
  }, [employees, selectedTeam]);

  const handleTeamChange = (team: string) => {
    setSelectedTeam(team);
    setSelectedEmpNo('');
    setError('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const emp = employees.find(e => e.emp_no === selectedEmpNo);
    if (!emp) { setError('직원을 선택해주세요.'); return; }
    const digits = emp.phone?.replace(/\D/g, '') ?? '';
    const expectedPw = digits.slice(-4);
    if (!expectedPw) { setError('등록된 전화번호가 없습니다. 관리자에게 문의하세요.'); return; }
    if (password !== expectedPw) { setError('비밀번호가 틀렸습니다. (전화번호 뒤 4자리)'); return; }
    onLogin({
      empNo: emp.emp_no,
      name: emp.name,
      team: emp.team,
      role: emp.role,
      isCommander: selectedTeam !== '교대근무자' && emp.is_commander,
    });
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 700, color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.8px',
    marginBottom: '7px', display: 'block',
  };

  const teamOptions = teams.map(t => ({ value: t, label: t }));
  const empOptions = filteredEmployees.map(e => ({
    value: e.emp_no,
    label: e.name,
    sub: `${e.team} · ${e.role}`,
  }));

  const selectedEmp = filteredEmployees.find(e => e.emp_no === selectedEmpNo);
  const empDisplayLabel = selectedEmp
    ? `${selectedEmp.name}  ${selectedEmp.team} · ${selectedEmp.role}`
    : '';

  return (
    <div className="content" style={{ justifyContent: 'center' }}>
      <style>{`
        @keyframes shieldPulse {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(59,130,246,0.4)); }
          50% { filter: drop-shadow(0 0 20px rgba(59,130,246,0.8)) drop-shadow(0 0 40px rgba(59,130,246,0.3)); }
        }
        @keyframes accentGlow {
          0%, 100% { opacity: 0.7; width: 60px; }
          50% { opacity: 1; width: 80px; }
        }
        .login-card {
          padding: 32px 24px;
          background: linear-gradient(145deg, rgba(15,23,42,0.95), rgba(30,41,59,0.85));
          border: 1px solid rgba(59,130,246,0.15);
          border-radius: 20px;
          backdrop-filter: blur(20px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .btn-enter {
          height: 52px; width: 100%; border: none; border-radius: 14px;
          font-size: 15px; font-weight: 800; letter-spacing: 1.5px;
          text-transform: uppercase; color: #fff; cursor: pointer;
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%);
          box-shadow: 0 4px 20px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
          transition: all 0.3s ease;
        }
        .btn-enter:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-enter:not(:disabled):active { transform: translateY(1px); }
        .pw-input {
          background: rgba(255,255,255,0.07); border: 1.5px solid rgba(255,255,255,0.12);
          border-radius: 12px; padding: 13px 16px;
          color: #f1f5f9; font-size: 20px; width: 100%; outline: none;
          box-sizing: border-box; letter-spacing: 8px; font-weight: 900;
          transition: all 0.15s;
        }
        .pw-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.25); }
        .pw-input::placeholder { letter-spacing: 0; font-weight: 400; font-size: 13px; color: #475569; }
        .login-error {
          background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3);
          border-radius: 10px; padding: 10px 14px; color: #fca5a5;
          font-size: 13px; font-weight: 600;
        }
        /* 드롭다운 내부 스크롤바 숨김 */
        .login-card *::-webkit-scrollbar { width: 0; }
      `}</style>

      <div className="login-card">
        {/* 아이콘 */}
        <div style={{ textAlign: 'center', marginBottom: '18px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '62px', height: '62px', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
            animation: 'shieldPulse 3s ease-in-out infinite',
          }}>
            <ShieldCheck size={34} color="#3b82f6" strokeWidth={2.2} />
          </div>
        </div>

        {/* 타이틀 */}
        <div style={{ textAlign: 'center', marginBottom: '26px' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '24px',
            marginBottom: '8px', color: '#f1f5f9', letterSpacing: '-0.3px',
          }}>
            트윈타워 재난알람
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500, marginBottom: '10px' }}>
            상황전파 협업업무
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              height: '3px', width: '70px', borderRadius: '2px',
              background: 'linear-gradient(90deg, transparent, #f97316, #fb923c, transparent)',
              animation: 'accentGlow 2.5s ease-in-out infinite',
            }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ① 부서 선택 */}
          <div>
            <label style={labelStyle}>① 부서 선택</label>
            {employees.length === 0
              ? <div style={{ color: '#64748b', fontSize: '13px', padding: '12px 0' }}>직원 데이터 로딩 중…</div>
              : <Dropdown
                  placeholder="부서를 선택하세요"
                  value={selectedTeam}
                  options={teamOptions}
                  onChange={handleTeamChange}
                />
            }
          </div>

          {/* ② 이름 선택 */}
          <div>
            <label style={{ ...labelStyle, color: selectedTeam ? '#3b82f6' : '#64748b' }}>
              ② 이름 선택{selectedTeam ? ` — ${selectedTeam}` : ''}
            </label>
            <Dropdown
              placeholder={selectedTeam ? '이름을 선택하세요' : '부서를 먼저 선택하세요'}
              value={selectedEmpNo}
              displayLabel={empDisplayLabel || undefined}
              disabled={!selectedTeam}
              options={empOptions}
              onChange={v => { setSelectedEmpNo(v); setError(''); }}
            />
          </div>

          {/* ③ 비밀번호 */}
          {selectedEmpNo && (
            <div>
              <label style={labelStyle}>③ 비밀번호 (전화번호 뒤 4자리)</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="전화번호 뒤 4자리"
                value={password}
                onChange={e => { setPassword(e.target.value.replace(/\D/g, '')); setError(''); }}
                required
                className="pw-input"
                autoFocus
              />
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn-enter" disabled={!selectedEmpNo}>
            로그인
          </button>
        </form>
      </div>
    </div>
  );
};
