import React, { useState, useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { type EmployeeDB } from '../services/supabase';

const normalizeTeam = (team: string): string => {
  if (team.startsWith('보안')) return '보안파트'; // 보안1, 보안2, 보안3
  if (team.endsWith('파트장')) return team.replace('파트장', '파트');
  return team;
};

const getRoleRank = (role: string): number => {
  if (role.startsWith('파트장')) return 0;
  if (role === '파트원') return 1;
  if (role.startsWith('파트원')) return 2; // 파트원(교대) 등 변형 포함
  return 3;
};

const TEAM_ORDER = [
  '상황실', '센터장', '기계파트', '전기파트', '소방파트', '운영파트',
  '품질파트', '건축파트', '보안파트', '주차파트', '미화파트',
];

export interface Employee {
  empNo: string;
  name: string;
  team: string;
  role: string;
  badge?: string; // 재난 발령 시 employee_disaster_badges 에서 동적으로 조회
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
    const teamSet = new Set(employees.map((e) => normalizeTeam(e.team)));
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
    return employees
      .filter((e) => normalizeTeam(e.team) === selectedTeam)
      .sort((a, b) => {
        const rd = getRoleRank(a.role) - getRoleRank(b.role);
        return rd !== 0 ? rd : a.name.localeCompare(b.name, 'ko');
      });
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
    if (!emp) {
      setError('직원을 선택해주세요.');
      return;
    }

    const digits = emp.phone?.replace(/\D/g, '') ?? '';
    const expectedPw = digits.slice(-4);
    if (!expectedPw) {
      setError('등록된 전화번호가 없습니다. 관리자에게 문의하세요.');
      return;
    }
    if (password !== expectedPw) {
      setError('비밀번호가 틀렸습니다. (전화번호 뒤 4자리)');
      return;
    }

    onLogin({
      empNo: emp.emp_no,
      name: emp.name,
      team: emp.team,
      role: emp.role,
      isCommander: emp.is_commander,
    });
  };

  const selectStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '12px',
    padding: '14px 16px',
    color: '#111',
    fontSize: '14px',
    width: '100%',
    outline: 'none',
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    marginBottom: '8px',
    display: 'block',
  };

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
          padding: 36px 28px;
          background: linear-gradient(145deg, rgba(15,23,42,0.95), rgba(30,41,59,0.85));
          border: 1px solid rgba(59,130,246,0.15);
          border-radius: 20px;
          backdrop-filter: blur(20px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .login-card-bold:hover {
          border-color: rgba(59,130,246,0.3);
          box-shadow: 0 12px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px rgba(59,130,246,0.05);
        }
        .btn-bold-enter {
          height: 52px;
          border: none;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #fff;
          cursor: pointer;
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%);
          box-shadow: 0 4px 20px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }
        .btn-bold-enter::before {
          content: '';
          position: absolute;
          top: 0; left: -100%; width: 100%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
          transition: left 0.5s ease;
        }
        .btn-bold-enter:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px rgba(59,130,246,0.5), inset 0 1px 0 rgba(255,255,255,0.2);
        }
        .btn-bold-enter:hover::before { left: 100%; }
        .btn-bold-enter:active { transform: translateY(0); }
        .login-pw-input {
          background: #fff;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 12px;
          padding: 14px 16px;
          color: #111;
          font-size: 20px;
          width: 100%;
          outline: none;
          box-sizing: border-box;
          letter-spacing: 8px;
          font-weight: 900;
        }
        .login-pw-input:focus {
          background: #fff;
          color: #111;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.25);
        }
        .login-pw-input::placeholder { letter-spacing: 0; font-weight: 400; font-size: 14px; color: #aaa; }
        .login-error {
          background: rgba(239,68,68,0.15);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: 10px;
          padding: 10px 14px;
          color: #fca5a5;
          font-size: 13px;
          font-weight: 600;
        }
      `}</style>

      <div className="login-card-bold">
        {/* Shield Icon */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
            animation: 'shieldPulse 3s ease-in-out infinite',
          }}>
            <ShieldCheck size={36} color="#3b82f6" strokeWidth={2.2} />
          </div>
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: '26px',
            marginBottom: '12px',
            color: '#f1f5f9',
            letterSpacing: '-0.3px',
          }}>
            트윈타워 재난알람
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 500, marginBottom: '10px' }}>
            상황전파 협업업무
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{
              height: '3px',
              width: '70px',
              borderRadius: '2px',
              background: 'linear-gradient(90deg, transparent, #f97316, #fb923c, transparent)',
              animation: 'accentGlow 2.5s ease-in-out infinite',
            }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Step 1: 부서 선택 */}
          <div>
            <label style={labelStyle}>① 부서 선택</label>
            <select
              value={selectedTeam}
              onChange={(e) => handleTeamChange(e.target.value)}
              required
              style={selectStyle}
            >
              <option value="">-- 부서를 먼저 선택하세요 --</option>
              {employees.length === 0 && (
                <option disabled value="">직원 데이터 로딩 중...</option>
              )}
              {teams.map((team) => (
                <option key={team} value={team} style={{ color: '#111' }}>
                  {team}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: 이름 선택 (부서 선택 후 활성화) */}
          <div>
            <label style={labelStyle}>② 이름(부서) 선택</label>
            <select
              value={selectedEmpNo}
              onChange={(e) => { setSelectedEmpNo(e.target.value); setError(''); }}
              required
              disabled={!selectedTeam}
              style={{
                ...selectStyle,
                opacity: selectedTeam ? 1 : 0.5,
                cursor: selectedTeam ? 'pointer' : 'not-allowed',
              }}
            >
              <option value="">
                {selectedTeam ? '-- 이름을 선택하세요 --' : '부서를 먼저 선택하세요'}
              </option>
              {filteredEmployees.map((emp) => (
                <option key={emp.emp_no} value={emp.emp_no} style={{ color: '#111' }}>
                  {emp.name} ({emp.team} · {emp.role})
                </option>
              ))}
            </select>
          </div>

          {/* Step 3: 비밀번호 (전화번호 뒤 4자리) */}
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
            />
          </div>

          {/* 에러 메시지 */}
          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn-bold-enter">
            로그인
          </button>
        </form>
      </div>
    </div>
  );
};
