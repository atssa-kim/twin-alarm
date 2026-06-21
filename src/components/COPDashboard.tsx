import React from 'react';
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

      {/* 3. Team-wise Status Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 800, paddingLeft: '2px' }}>
          조직도별 실시간 임무 수행율
        </h3>

        {disasterManual?.members.map((member) => {
          const roleTasks = tasks.filter(t => t.role === member.role);
          const roleCompleted = roleTasks.filter(t => t.done).length;
          const roleTotal = roleTasks.length;
          const rolePct = roleTotal > 0 ? Math.round((roleCompleted / roleTotal) * 100) : 0;

          // Find responders checks-in for this role
          const roleResponders = responders.filter(
            r => r.role === member.role || r.role.includes(member.badge)
          );

          return (
            <div key={member.role} className="card" style={{ padding: '14px 16px', marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <strong style={{ fontSize: '14px', color: member.bc || 'var(--text-main)' }}>
                    {member.role}
                  </strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    소속반: {member.group} | 배지: {member.badge}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: rolePct === 100 ? 'var(--color-green)' : 'var(--text-main)' }}>
                    {rolePct}%
                  </span>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {roleCompleted}/{roleTotal} 건
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="progress-track" style={{ height: '6px', marginBottom: '8px' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${rolePct}%`,
                    backgroundColor: rolePct === 100 ? 'var(--color-green)' : member.bc || 'var(--color-fire)'
                  }}
                ></div>
              </div>

              {/* Responder status names for this card */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                {roleResponders.length === 0 ? (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    대기중 (배치 인원 없음)
                  </span>
                ) : (
                  roleResponders.map(r => {
                    let badgeColor = 'rgba(255, 255, 255, 0.05)';
                    let textColor = 'var(--text-muted)';
                    if (r.status === '출동중') { badgeColor = 'rgba(245, 158, 11, 0.15)'; textColor = 'var(--color-power)'; }
                    if (r.status === '현장') { badgeColor = 'rgba(59, 130, 246, 0.15)'; textColor = '#60a5fa'; }
                    if (r.status === '복귀') { badgeColor = 'rgba(16, 185, 129, 0.15)'; textColor = 'var(--color-green)'; }

                    return (
                      <span key={r.emp_no} style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        backgroundColor: badgeColor,
                        color: textColor,
                        fontWeight: 700,
                        border: '1px solid rgba(255, 255, 255, 0.05)'
                      }}>
                        {r.name} ({r.status})
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* 4. Live Activity Section */}
      <div className="card" style={{ marginTop: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <Activity size={18} color="var(--color-green)" />
          <h3 style={{ margin: 0, fontSize: '14px' }}>최근 대응 활동</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
          {tasks.filter(t => t.done).length === 0 && responders.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '10px' }}>
              아직 발생한 대응 활동 내역이 없습니다.
            </div>
          ) : (
            [
              // Create combined sorted log of responder updates and completed tasks
              ...responders.map(r => ({
                time: r.updated_at,
                text: `[대원] ${r.name} (${r.role}) -> ${r.status} 상태 변경`
              })),
              ...tasks.filter(t => t.done).map(t => ({
                time: t.updated_at || activeIncident.declared_at,
                text: `[임무] ${t.role} -> "${t.label}" 완료 처리`
              }))
            ]
            .sort((a, b) => b.time - a.time)
            .slice(0, 20)
            .map((log, idx) => (
              <div key={idx} style={{ 
                fontSize: '12px', 
                padding: '6px 8px', 
                background: 'rgba(255,255,255,0.02)', 
                borderLeft: '2px solid rgba(255,255,255,0.1)',
                color: log.text.startsWith('[임무]') ? 'var(--text-main)' : 'var(--text-muted)'
              }}>
                {log.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
