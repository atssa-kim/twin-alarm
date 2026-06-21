import React, { useState } from 'react';

export interface Employee {
  empNo: string;
  name: string;
  team: string;
  role: string;
  badge: string;
  isCommander: boolean;
}

export const ROSTER: Employee[] = [
  { empNo: 'B-1001', name: '한지휘', team: '지휘반', role: '센터장 (총괄자)', badge: '총괄', isCommander: true },
  { empNo: 'B-1002', name: '오부장', team: '지휘반', role: '소방파트장 (안전관리자)', badge: '통제', isCommander: true },
  { empNo: 'B-4001', name: '상황실A', team: '상황실', role: '상황통보원', badge: '상황', isCommander: false },
  { empNo: 'B-2041', name: '김재난', team: '대응반', role: '비상출동원 (전기/소방)', badge: '출동', isCommander: false },
  { empNo: 'B-2042', name: '이소방', team: '대응반', role: '소화대원 (기계)', badge: '소화', isCommander: false },
  { empNo: 'B-2043', name: '박구조', team: '대응반', role: '인명구조원 (보안)', badge: '구조', isCommander: false },
  { empNo: 'B-3001', name: '정유도', team: '유도반', role: '대피유도조', badge: '유도', isCommander: false },
  { empNo: 'B-3002', name: '한경계', team: '유도반', role: '경계조 대원', badge: '경계', isCommander: false },
  { empNo: 'B-5001', name: '최복구', team: '지원반', role: '설비복구조', badge: '복구', isCommander: false }
];

interface LoginProps {
  onLogin: (user: Employee) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [selectedEmpNo, setSelectedEmpNo] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const user = ROSTER.find((emp) => emp.empNo === selectedEmpNo);
    if (user) {
      onLogin(user);
    } else {
      alert('대원을 선택해주세요.');
    }
  };

  return (
    <div className="content" style={{ justifyContent: 'center' }}>
      <div className="card" style={{ padding: '30px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '24px', marginBottom: '8px' }}>
            🏢 트윈타워 재난알람
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            상황전파 협업업무
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label htmlFor="emp-select">로그인 대원 선택</label>
            <select
              id="emp-select"
              value={selectedEmpNo}
              onChange={(e) => setSelectedEmpNo(e.target.value)}
              required
            >
              <option value="">-- 사번 및 이름 선택 --</option>
              {ROSTER.map((emp) => (
                <option key={emp.empNo} value={emp.empNo}>
                  [{emp.empNo}] {emp.name} - {emp.team} ({emp.role})
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn-primary" style={{ height: '48px' }}>
            System Enter
          </button>
        </form>
      </div>
    </div>
  );
};
