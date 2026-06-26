import React, { useState } from 'react';
import { type Incident, type Responder, type MemberTask } from '../services/supabase';
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
          // tasks 기준으로 역할별 임무 완수율 집계 (◇◆ 헤더 제외)
          const roleMap: Record<string, { done: number; total: number }> = {};
          tasks.forEach(t => {
            if (t.label.startsWith('◇') || t.label.startsWith('◆')) return;
            if (!roleMap[t.role]) roleMap[t.role] = { done: 0, total: 0 };
            roleMap[t.role].total++;
            if (t.done) roleMap[t.role].done++;
          });
          const roles = Object.entries(roleMap);

          if (roles.length === 0) {
            return (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
                발령된 임무 데이터가 없습니다.
              </div>
            );
          }

          return (
            <div style={{ padding: '8px 16px 12px', maxHeight: '360px', overflowY: 'auto' }}>
              {roles.map(([role, { done, total }]) => {
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <div key={role} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '12px', fontWeight: 600, color: 'var(--text-main)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        marginBottom: '4px',
                      }}>
                        {role}
                      </div>
                      <div className="progress-track" style={{ height: '3px' }}>
                        <div className="progress-fill" style={{
                          width: `${pct}%`,
                          backgroundColor: pct === 100 ? 'var(--color-green)' : 'var(--color-water)',
                        }} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '42px' }}>
                      <div style={{
                        fontSize: '12px', fontWeight: 800,
                        color: pct === 100 ? 'var(--color-green)' : 'var(--text-main)',
                      }}>
                        {pct === 100 ? '✓' : `${pct}%`}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{done}/{total}건</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
      
      {/* 4. Live Activity Section */}
      <div className="card" style={{ marginTop: '10px', padding: 0, overflow: 'hidden' }}>
        <div
          className="accordion-header"
          onClick={() => setShowActivityLog(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: showActivityLog ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
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
                  fontSize: '14px', padding: '5px 6px',
                  background: 'rgba(255,255,255,0.02)',
                  borderLeft: `2px solid ${e.color}`,
                  borderRadius: '0 6px 6px 0',
                }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtTime(e.time)}
                  </span>
                  <span style={{
                    fontSize: '11px', color: e.color, fontWeight: 800, flexShrink: 0,
                    background: e.color + '22', padding: '0 4px', borderRadius: '3px',
                  }}>
                    {e.tag}
                  </span>
                  <span style={{ color: 'var(--text-main)', flex: 1, fontSize: '14px' }}>{e.text}</span>
                </div>
              ));
            })()
          )}
        </div>}
      </div>
    </div>
  );
};
