import React, { useState, useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
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
  '품질파트', '건축파트', '보안파트', '주차파트', '미화파트',
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
    const emp = employees.find((e) => e.emp_no === selectedEmpNo);
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
    fontSize: '11px',
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    marginBottom: '8px',
    display: 'block',
  };

  const teamBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    borderRadius: '10px',
    border: active ? 'none' : '1px solid rgba(255,255,255,0.12)',
    background: active ? '#2563eb' : 'rgba(255,255,255,0.05)',
    color: active ? '#fff' : '#94a3b8',
    fontSize: '13px',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  });

  const empBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 14px',
    borderRadius: '8px',
    border: active ? '1px solid #3b82f6' : '1px solid transparent',
    background: active ? 'rgba(37,99,235,0.25)' : 'rgba(255,255,255,0.03)',
    color: active ? '#93c5fd' : '#e2e8f0',
    fontSize: '14px',
    fontWeight: active ? 700 : 400,
    textAlign: 'left' as const,
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.12s',
  });

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
        .login-card-bold {
          padding: 28px 22px;
          background: linear-gradient(145deg, rgba(15,23,42,0.95), rgba(30,41,59,0.85));
          border: 1px solid rgba(59,130,246,0.15);
          border-radius: 20px;
          backdrop-filter: blur(20px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .btn-bold-enter {
          height: 52px; width: 100%;
          border: none; border-radius: 14px;
          font-size: 15px; font-weight: 800;
          letter-spacing: 1.5px; text-transform: uppercase;
          color: #fff; cursor: pointer;
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%);
          box-shadow: 0 4px 20px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
          transition: all 0.3s ease;
        }
        .btn-bold-enter:active { transform: translateY(1px); }
        .login-pw-input {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 12px; padding: 14px 16px;
          color: #f1f5f9; font-size: 20px; width: 100%;
          outline: none; box-sizing: border-box;
          letter-spacing: 8px; font-weight: 900;
        }
        .login-pw-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.25);
        }
        .login-pw-input::placeholder { letter-spacing: 0; font-weight: 400; font-size: 14px; color: #475569; }
        .login-error {
          background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3);
          border-radius: 10px; padding: 10px 14px;
          color: #fca5a5; font-size: 13px; font-weight: 600;
        }
        .emp-scroll::-webkit-scrollbar { width: 0; }
      `}</style>

      <div className="login-card-bold">
        {/* 아이콘 */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '60px', height: '60px', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
            animation: 'shieldPulse 3s ease-in-out infinite',
          }}>
            <ShieldCheck size={34} color="#3b82f6" strokeWidth={2.2} />
          </div>
        </div>

        {/* 타이틀 */}
        <div style={{ textAlign: 'center', marginBottom: '22px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '24px', marginBottom: '8px', color: '#f1f5f9', letterSpacing: '-0.3px' }}>
            트윈타워 재난알람
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>상황전파 협업업무</p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ height: '3px', width: '70px', borderRadius: '2px', background: 'linear-gradient(90deg, transparent, #f97316, #fb923c, transparent)', animation: 'accentGlow 2.5s ease-in-out infinite' }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* ① 부서 선택 — 인라인 버튼 그리드 (시스템 팝업 없음) */}
          <div>
            <label style={labelStyle}>① 부서 선택</label>
            {employees.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: '13px', padding: '10px 0' }}>직원 데이터 로딩 중…</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {teams.map(team => (
                  <button key={team} type="button" onClick={() => handleTeamChange(team)} style={teamBtnStyle(selectedTeam === team)}>
                    {team}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ② 이름 선택 — 인라인 스크롤 리스트 (시스템 팝업 없음) */}
          {selectedTeam && (
            <div>
              <label style={labelStyle}>② 이름 선택 <span style={{ color: '#3b82f6', textTransform: 'none', letterSpacing: 0 }}>— {selectedTeam}</span></label>
              <div className="emp-scroll" style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px', borderRadius: '12px', background: 'rgba(0,0,0,0.2)', padding: '6px', border: '1px solid rgba(255,255,255,0.07)' }}>
                {filteredEmployees.map(emp => (
                  <button
                    key={emp.emp_no}
                    type="button"
                    onClick={() => { setSelectedEmpNo(emp.emp_no); setError(''); }}
                    style={empBtnStyle(selectedEmpNo === emp.emp_no)}
                  >
                    {emp.name}
                    <span style={{ fontSize: '11px', marginLeft: '6px', color: selectedEmpNo === emp.emp_no ? 'rgba(147,197,253,0.8)' : '#64748b' }}>
                      {emp.team} · {emp.role}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

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
                onChange={(e) => { setPassword(e.target.value.replace(/\D/g, '')); setError(''); }}
                required
                className="login-pw-input"
                autoFocus
              />
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn-bold-enter" disabled={!selectedEmpNo}>
            로그인
          </button>
        </form>
      </div>
    </div>
  );
};
