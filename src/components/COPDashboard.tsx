import React, { useState } from 'react';
import { type Incident, type Responder, type MemberTask } from '../services/supabase';
import { DISASTERS } from '../data/disasters';
import { Activity, Clock } from 'lucide-react';

interface COPDashboardProps {
  activeIncident: Incident | null;
  responders: Responder[];
  tasks: MemberTask[];
}

export const COPDashboard: React.FC<COPDashboardProps> = ({
  activeIncident,
  responders,
  tasks
}) => {
  if (!activeIncident) {
    return (
      <div className="content">
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>🏢</div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', marginBottom: '8px' }}>
            공동 상황판 (COP) 대기 중
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            현재 발령된 활성 재난이 없습니다.<br />
            비상대응 센터 상황판이 대기 상태입니다.
          </p>
        </div>
      </div>
    );
  }

  const disasterManual = DISASTERS.find(d => d.key === activeIncident.disaster);
  const [showRoles, setShowRoles] = useState(true);
  const [showActivityLog, setShowActivityLog] = useState(false);

  // Overall calculations
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.done).length;
  const overallPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Format elapsed time
  const getElapsedTime = () => {
    const diffMs = Date.now() - activeIncident.declared_at;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
  };

  return (
    <div className="content" style={{ gap: '14px' }}>
      {/* 1. COP Header */}
      <div className="banner alarm-active" style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderColor: activeIncident.mode === '실제' ? 'var(--color-fire)' : 'var(--color-water)',
        padding: '16px 20px',
        marginBottom: 0
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{
            fontSize: '11px', 
            fontWeight: 900, 
            padding: '2px 8px', 
            borderRadius: '6px',
            background: activeIncident.mode === '실제' ? 'var(--color-fire)' : 'var(--color-water)'
          }}>
            {activeIncident.mode === '실제' ? '⚠️ 실제상황' : '🎓 훈련상황'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <Clock size={14} />
            <span>경과 시간: {getElapsedTime()}</span>
          </div>
        </div>
        
        <h2 style={{ fontSize: '22px', fontWeight: 900, marginTop: '10px', fontFamily: 'var(--font-display)' }}>
          {activeIncident.disaster} 상황판 (COP)
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
          위치: <strong>{activeIncident.location}</strong>
        </p>
      </div>

      {/* 2. Key Metrics Grid */}
      <div className="cop-grid">
        <div className="cop-stat-card" style={{ borderLeft: '4px solid var(--color-fire)' }}>
          <div className="cop-stat-val" style={{ color: 'var(--color-fire)' }}>{overallPct}%</div>
          <div className="cop-stat-label">전체 임무 완수율</div>
        </div>
        <div className="cop-stat-card" style={{ borderLeft: '4px solid var(--color-green)' }}>
          <div className="cop-stat-val" style={{ color: 'var(--color-green)' }}>
            {responders.filter(r => r.status === '현장').length} / {responders.length}
          </div>
          <div className="cop-stat-label">소집 대원 현장도착</div>
        </div>
      </div>

      {/* 3. Role Matrix — Compact Accordion */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          className="accordion-header"
          onClick={() => setShowRoles(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: showRoles ? '1px solid rgba(255,255,255,0.06)' : 'none',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: 'var(--text-main)', flex: 1, textAlign: 'center' }}>
            조직별 실시간 임무수행율
          </h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {showRoles ? '▲' : '▼'}
          </span>
        </div>

        {showRoles && (() => {
          const members = disasterManual?.members ?? [];
          const grouped = members.reduce((acc, m) => {
            (acc[m.group] ??= []).push(m);
            return acc;
          }, {} as Record<string, typeof members>);

          return (
            <div style={{ padding: '8px 16px 12px' }}>
              {Object.entries(grouped).map(([group, groupMembers]) => (
                <div key={group} style={{ marginBottom: '10px' }}>
                  <div style={{
                    fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    paddingBottom: '4px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    marginBottom: '4px',
                  }}>
                    {group}
                  </div>
                  {groupMembers.map(member => {
                    const roleTasks = tasks.filter(t => t.role === member.role);
                    const roleCompleted = roleTasks.filter(t => t.done).length;
                    const roleTotal = roleTasks.length;
                    const rolePct = roleTotal > 0 ? Math.round((roleCompleted / roleTotal) * 100) : 0;
                    const roleResponders = responders.filter(
                      r => r.role === member.role || r.role.includes(member.badge)
                    );
                    const bc = member.bc || '#6b7280';

                    return (
                      <div key={member.role} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '5px 0',
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                      }}>
                        {/* Badge pill */}
                        <span style={{
                          fontSize: '9px', fontWeight: 800,
                          padding: '1px 5px', borderRadius: '4px',
                          background: bc + '33', color: bc,
                          border: `1px solid ${bc}55`,
                          whiteSpace: 'nowrap', flexShrink: 0,
                          minWidth: '30px', textAlign: 'center',
                        }}>
                          {member.badge}
                        </span>

                        {/* Role name + thin progress bar */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: '11px', fontWeight: 600, color: 'var(--text-main)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            marginBottom: '3px',
                          }}>
                            {member.role}
                          </div>
                          <div className="progress-track" style={{ height: '3px' }}>
                            <div className="progress-fill" style={{
                              width: `${rolePct}%`,
                              backgroundColor: rolePct === 100 ? 'var(--color-green)' : bc,
                            }} />
                          </div>
                        </div>

                        {/* Percentage + count */}
                        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '38px' }}>
                          <div style={{
                            fontSize: '12px', fontWeight: 800,
                            color: rolePct === 100 ? 'var(--color-green)' : 'var(--text-main)',
                          }}>
                            {rolePct === 100 ? '✓' : `${rolePct}%`}
                          </div>
                          {roleTotal > 0 && (
                            <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                              {roleCompleted}/{roleTotal}건
                            </div>
                          )}
                        </div>

                        {/* Responder count */}
                        {roleResponders.length > 0 && (
                          <span style={{
                            fontSize: '10px', color: 'var(--color-water)',
                            flexShrink: 0, fontWeight: 700,
                          }}>
                            👤{roleResponders.length}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      
      {/* 4. Live Activity Section */}
      <div className="card" style={{ marginTop: '10px', padding: 0, overflow: 'hidden' }}>
        <div
          onClick={() => setShowActivityLog(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', cursor: 'pointer', borderBottom: showActivityLog ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
        >
          <Activity size={18} color="var(--color-green)" />
          <h3 style={{ margin: 0, fontSize: '14px', flex: 1 }}>활동로그</h3>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{showActivityLog ? '▲' : '▼'}</span>
        </div>
        {showActivityLog && <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto', padding: '10px 16px 14px' }}>
          {tasks.filter(t => t.done).length === 0 && responders.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>
              아직 발생한 대응 활동 내역이 없습니다.
            </div>
          ) : (
            (() => {
              const fmtTime = (ms: number) => {
                const d = new Date(ms);
                return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              };
              const entries = [
                ...responders.filter(r => r.emp_no && r.name && r.status !== '미응답').map(r => ({
                  time: r.updated_at,
                  tag: '대원',
                  color: r.status === '현장' ? '#60a5fa' : r.status === '출동중' ? 'var(--color-power)' : 'var(--color-green)',
                  text: `${r.name} → ${r.status}`,
                })),
                ...tasks.filter(t => t.done).map(t => ({
                  time: t.updated_at || activeIncident.declared_at,
                  tag: '임무',
                  color: 'var(--color-green)',
                  text: `${t.done_by ?? t.role} — ${t.label.length > 22 ? t.label.slice(0, 22) + '…' : t.label}`,
                })),
              ].sort((a, b) => b.time - a.time).slice(0, 25);

              return entries.map((e, idx) => (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'baseline', gap: '6px',
                  fontSize: '12px', padding: '4px 6px',
                  background: 'rgba(255,255,255,0.02)',
                  borderLeft: `2px solid ${e.color}`,
                  borderRadius: '0 6px 6px 0',
                }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTime(e.time)}
                  </span>
                  <span style={{
                    fontSize: '10px', color: e.color, fontWeight: 800, flexShrink: 0,
                    background: e.color + '22', padding: '0 4px', borderRadius: '3px',
                  }}>
                    {e.tag}
                  </span>
                  <span style={{ color: 'var(--text-main)', flex: 1 }}>{e.text}</span>
                </div>
              ));
            })()
          )}
        </div>}
      </div>
    </div>
  );
};
