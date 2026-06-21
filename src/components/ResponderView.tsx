import React, { useEffect, useState } from 'react';
import { type Incident, type Responder, type MemberTask, db } from '../services/supabase';
import { DISASTERS } from '../data/disasters';
import { type Employee } from './Login';
import { Check, ShieldAlert, MapPin, Award, CheckSquare } from 'lucide-react';

interface ResponderViewProps {
  activeIncident: Incident | null;
  responders: Responder[];
  tasks: MemberTask[];
  currentUser: Employee;
}

export const ResponderView: React.FC<ResponderViewProps> = ({
  activeIncident,
  responders,
  tasks,
  currentUser
}) => {
  const [loading, setLoading] = useState(false);

  // Find this responder's current status inside the active incident
  const currentResponder = responders.find(r => r.emp_no === currentUser.empNo);
  const responderStatus = currentResponder ? currentResponder.status : '미응답';

  // Find the manual member configuration that matches this user's role badge
  const disasterManual = activeIncident 
    ? DISASTERS.find(d => d.key === activeIncident.disaster)
    : null;

  const manualMember = disasterManual
    ? disasterManual.members.find(m => m.badge === currentUser.badge)
    : null;

  // Filter tasks belonging to this responder's role
  const myTasks = manualMember
    ? tasks.filter(t => t.role === manualMember.role)
    : [];

  // Register or update responder status
  const updateStatus = async (status: Responder['status']) => {
    if (!activeIncident) return;
    setLoading(true);
    try {
      await db.setResponderStatus(
        activeIncident.id,
        currentUser.empNo,
        currentUser.name,
        currentUser.team,
        currentUser.role,
        status
      );
    } catch (err: any) {
      alert('상태 업데이트 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Automatically check in as "출동중" if incident activates and user is in "미응답" status
  useEffect(() => {
    if (activeIncident && responderStatus === '미응답') {
      updateStatus('출동중');
    }
  }, [activeIncident]);

  const handleTaskToggle = async (task: MemberTask) => {
    setLoading(true);
    try {
      await db.toggleTaskDone(task.id, !task.done);
    } catch (err: any) {
      alert('임무 상태 변경 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Individual Progress Calculation
  const totalTasksCount = myTasks.length;
  const completedTasksCount = myTasks.filter(t => t.done).length;
  const myProgressPct = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

  return (
    <div className="content">
      {!activeIncident ? (
        // 1. STANDBY STATE (No Active Incident)
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
            border: '2px solid rgba(16, 185, 129, 0.2)'
          }}>
            <span style={{ fontSize: '24px' }}>🟢</span>
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', marginBottom: '8px' }}>
            비상 대기 중
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5 }}>
            현재 발령된 비상 상황이 없습니다.<br />
            재난 수신기가 감지되거나 지휘자가 발령하면 여기에 알람이 표시됩니다.
          </p>
        </div>
      ) : (
        // 2. ACTIVE INCIDENT STATE (Mission checklists and status buttons)
        <>
          {/* Active Incident Banner */}
          <div className="banner alarm-active" style={{
            background: activeIncident.mode === '실제' 
              ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.3) 100%)'
              : 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(217, 119, 6, 0.25) 100%)',
            borderColor: activeIncident.mode === '실제' ? 'var(--color-fire)' : 'var(--color-power)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="banner-title" style={{ color: activeIncident.mode === '실제' ? 'var(--color-fire)' : 'var(--color-power)' }}>
                <ShieldAlert size={20} />
                <span>{activeIncident.mode === '실제' ? '🚨 실제 비상 상황' : '🎓 대응 훈련 상황'}</span>
              </div>
              <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '6px' }}>
                {activeIncident.disaster}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', marginTop: '10px', color: 'var(--text-main)' }}>
              <MapPin size={16} color="var(--text-muted)" />
              <span>위치: <strong>{activeIncident.location}</strong></span>
            </div>
          </div>

          {/* Responder Status Switcher */}
          <div className="card">
            <label>나의 대응 상태</label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn"
                style={{
                  flex: 1,
                  padding: '12px',
                  background: responderStatus === '출동중' ? 'var(--color-power)' : 'rgba(255,255,255,0.05)',
                  fontSize: '13px',
                  border: responderStatus === '출동중' ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}
                onClick={() => updateStatus('출동중')}
                disabled={loading}
              >
                🚨 출동중
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  flex: 1,
                  padding: '12px',
                  background: responderStatus === '현장' ? 'var(--color-water)' : 'rgba(255,255,255,0.05)',
                  fontSize: '13px',
                  border: responderStatus === '현장' ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}
                onClick={() => updateStatus('현장')}
                disabled={loading}
              >
                📍 현장도착
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  flex: 1,
                  padding: '12px',
                  background: responderStatus === '복귀' ? 'var(--color-green)' : 'rgba(255,255,255,0.05)',
                  fontSize: '13px',
                  border: responderStatus === '복귀' ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}
                onClick={() => updateStatus('복귀')}
                disabled={loading}
              >
                ✅ 복귀완료
              </button>
            </div>
          </div>

          {/* Role and Mission Card Progress */}
          {manualMember ? (
            <>
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Award size={20} color="var(--color-power)" />
                  <h3 style={{ margin: 0, fontSize: '15px' }}>
                    나의 임무 카드: <span style={{ color: manualMember.bc }}>{manualMember.role}</span>
                  </h3>
                </div>

                <div className="progress-container">
                  <div className="progress-header">
                    <span>임무 카드 수행률</span>
                    <strong style={{ color: myProgressPct === 100 ? 'var(--color-green)' : 'var(--color-power)' }}>
                      {myProgressPct}% {myProgressPct === 100 && '✓'}
                    </strong>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${myProgressPct}%`,
                        backgroundColor: myProgressPct === 100 ? 'var(--color-green)' : manualMember.bc || 'var(--color-fire)'
                      }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Task Checklist */}
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <CheckSquare size={18} color="var(--color-green)" />
                  <h3 style={{ margin: 0, fontSize: '14px' }}>행동 매뉴얼 체크리스트 ({completedTasksCount} / {totalTasksCount})</h3>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {myTasks.map((task) => (
                    <div
                      key={task.id}
                      className={`task-item ${task.done ? 'done' : ''}`}
                      onClick={() => handleTaskToggle(task)}
                    >
                      <div className="checkbox-visual">
                        <Check size={14} strokeWidth={3} />
                      </div>
                      <div className="task-label">{task.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            // No R&R found in manual for user's badge under this disaster
            <div className="card" style={{ textAlign: 'center', padding: '30px 16px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                죄송합니다. 이 재난 유형({activeIncident.disaster})에는 {currentUser.team}({currentUser.role})의 별도 지정된 행동 임무가 없거나 소집 대상이 아닙니다.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '10px' }}>
                상황실 및 총괄자의 통제 하에 대피 유도나 현장 통제를 지원해 주시기 바랍니다.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
