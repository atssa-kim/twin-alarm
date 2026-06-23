import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { type EmployeeDB } from '../services/supabase';

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
  availableVoices: SpeechSynthesisVoice[];
  selectedVoiceName: string;
  onVoiceChange: (voiceName: string) => void;
  employees: EmployeeDB[];
}

export const Login: React.FC<LoginProps> = ({
  onLogin,
  availableVoices,
  selectedVoiceName,
  onVoiceChange,
  employees,
}) => {
  const [selectedEmpNo, setSelectedEmpNo] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find((e) => e.emp_no === selectedEmpNo);
    if (emp) {
      onLogin({
        empNo: emp.emp_no,
        name: emp.name,
        team: emp.team,
        role: emp.role,
        isCommander: emp.is_commander,
      });
    } else {
      alert('대원을 선택해주세요.');
    }
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
        .btn-bold-enter:hover::before {
          left: 100%;
        }
        .btn-bold-enter:active {
          transform: translateY(0);
        }
      `}</style>

      <div className="login-card-bold">
        {/* Shield Icon with glow */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
            animation: 'shieldPulse 3s ease-in-out infinite'
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
            letterSpacing: '-0.3px'
          }}>
            트윈타워 재난알람
          </h2>
          {/* Subtitle with orange accent line */}
          <p style={{
            color: '#94a3b8',
            fontSize: '14px',
            fontWeight: 500,
            marginBottom: '10px'
          }}>
            상황전파 협업업무
          </p>
          <div style={{
            display: 'flex',
            justifyContent: 'center'
          }}>
            <div style={{
              height: '3px',
              width: '70px',
              borderRadius: '2px',
              background: 'linear-gradient(90deg, transparent, #f97316, #fb923c, transparent)',
              animation: 'accentGlow 2.5s ease-in-out infinite'
            }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label htmlFor="emp-select" style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '8px',
              display: 'block'
            }}>
              로그인 대원 선택
            </label>
            <select
              id="emp-select"
              value={selectedEmpNo}
              onChange={(e) => setSelectedEmpNo(e.target.value)}
              required
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '14px 16px',
                color: '#e2e8f0',
                fontSize: '14px',
                width: '100%',
                outline: 'none',
                transition: 'border-color 0.2s ease',
                cursor: 'pointer'
              }}
            >
              <option value="">-- 사번 및 이름 선택 --</option>
              {employees.length === 0 && (
                <option disabled value="">직원 데이터 로딩 중...</option>
              )}
              {employees.map((emp) => (
                <option key={emp.emp_no} value={emp.emp_no}>
                  [{emp.emp_no}] {emp.name} - {emp.team} ({emp.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="voice-select" style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '8px',
              display: 'block'
            }}>
              TTS 안내 화자 설정
            </label>
            <select
              id="voice-select"
              value={selectedVoiceName}
              onChange={(e) => onVoiceChange(e.target.value)}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '14px 16px',
                color: '#e2e8f0',
                fontSize: '14px',
                width: '100%',
                outline: 'none',
                transition: 'border-color 0.2s ease',
                cursor: 'pointer'
              }}
            >
              {availableVoices.length === 0 ? (
                <option value="">사용 가능한 화자 없음 (기본값)</option>
              ) : (
                availableVoices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} ({voice.lang})
                  </option>
                ))
              )}
            </select>
          </div>

          <button type="submit" className="btn-bold-enter">
            System Enter
          </button>
        </form>
      </div>
    </div>
  );
};
