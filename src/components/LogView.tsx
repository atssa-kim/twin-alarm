import React, { useState } from 'react';
import { type Incident, type Responder, type MemberTask } from '../services/supabase';
import { ScrollText } from 'lucide-react';

interface LogViewProps {
  activeIncident: Incident | null;
  responders: Responder[];
  tasks: MemberTask[];
}

type FilterType = '전체' | '임무완료' | '대원이동';

const STATUS_COLOR: Record<string, string> = {
  '출동중': 'var(--color-power)',
  '현장': '#60a5fa',
  '복귀': 'var(--color-green)',
};

const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};

export const LogView: React.FC<LogViewProps> = ({ activeIncident, responders, tasks }) => {
  const [filter, setFilter] = useState<FilterType>('전체');

  if (!activeIncident) {
    return (
      <div className="content">
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <ScrollText size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.6 }}>
            활성 재난이 없습니다.<br />재난 발령 후 대응 활동이 기록됩니다.
          </p>
        </div>
      </div>
    );
  }

  type Entry = {
    time: number;
    type: 'task' | 'responder';
    who: string;
    status?: string;
    team?: string;
    taskLabel?: string;
  };

  const taskEntries: Entry[] = tasks
    .filter(t => t.done)
    .map(t => ({
      time: t.updated_at ?? activeIncident.declared_at,
      type: 'task',
      who: t.done_by ?? '(미확인)',
      taskLabel: t.label,
    }));

  const responderEntries: Entry[] = responders
    .filter(r => r.emp_no && r.name && r.status !== '미응답')
    .map(r => ({
      time: r.updated_at,
      type: 'responder',
      who: r.name,
      status: r.status,
      team: r.team,
    }));

  const allEntries = [...taskEntries, ...responderEntries].sort((a, b) => b.time - a.time);

  const filtered =
    filter === '임무완료' ? allEntries.filter(e => e.type === 'task') :
    filter === '대원이동' ? allEntries.filter(e => e.type === 'responder') :
    allEntries;

  return (
    <div className="content" style={{ gap: '12px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 2px' }}>
        <ScrollText size={18} color="var(--color-green)" />
        <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>활동 로그</h2>
        <span style={{
          fontSize: '11px', color: 'var(--text-muted)',
          background: 'rgba(11,37,69,0.06)', padding: '2px 8px', borderRadius: '6px',
          marginLeft: 'auto',
        }}>
          {allEntries.length}건
        </span>
      </div>

      {/* 재난 정보 */}
      <div style={{
        fontSize: '12px', color: 'var(--text-muted)', padding: '6px 12px',
        background: 'rgba(11,37,69,0.035)', borderRadius: '10px',
        borderLeft: `3px solid ${activeIncident.mode === '실제' ? 'var(--color-fire)' : 'var(--color-water)'}`,
      }}>
        {activeIncident.mode === '실제' ? '⚠️ 실제상황' : '🎓 훈련상황'} · {activeIncident.disaster} · {activeIncident.location}
      </div>

      {/* 필터 탭 */}
      <div className="segmented-control">
        {(['전체', '임무완료', '대원이동'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`segmented-btn${filter === f ? ' active' : ''}`}
          >
            {f === '임무완료' ? `임무완료 ${taskEntries.length}` :
             f === '대원이동' ? `대원이동 ${responderEntries.length}` : f}
          </button>
        ))}
      </div>

      {/* 로그 목록 */}
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
            {filter === '전체'
              ? '아직 대응 활동이 없습니다.\n출동 또는 임무 체크 시 여기에 기록됩니다.'
              : `${filter} 내역이 없습니다.`}
          </div>
        ) : (
          filtered.map((e, i) => {
            const color = e.type === 'task' ? 'var(--color-green)' : STATUS_COLOR[e.status ?? ''] ?? 'var(--text-muted)';
            const tagLabel = e.type === 'task' ? '임무' : e.status ?? '';
            const isLast = i === filtered.length - 1;

            return (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '58px 1fr',
                borderBottom: isLast ? 'none' : '1px solid rgba(11,37,69,0.045)',
              }}>
                {/* 시간 + 타임라인 선 */}
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '12px 0 12px 0', gap: '4px',
                }}>
                  <span style={{
                    fontSize: '10px', color: 'var(--text-muted)',
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                  }}>
                    {fmtTime(e.time)}
                  </span>
                  {!isLast && (
                    <div style={{
                      width: '1px', flex: 1, minHeight: '8px',
                      background: 'rgba(11,37,69,0.09)',
                    }} />
                  )}
                </div>

                {/* 콘텐츠 */}
                <div style={{ padding: '10px 14px 10px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: e.type === 'task' ? '4px' : 0 }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 800,
                      padding: '1px 6px', borderRadius: '4px',
                      background: color + '22', color,
                      border: `1px solid ${color}44`,
                      flexShrink: 0,
                    }}>
                      {tagLabel}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                      {e.who}
                    </span>
                    {e.type === 'responder' && e.team && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        ({e.team})
                      </span>
                    )}
                  </div>
                  {e.type === 'task' && e.taskLabel && (
                    <div style={{
                      fontSize: '12px', color: 'var(--text-muted)',
                      lineHeight: 1.45, wordBreak: 'break-word',
                    }}>
                      {e.taskLabel}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
