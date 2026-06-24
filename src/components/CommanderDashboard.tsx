import React, { useRef, useState } from 'react';
import { type Incident, type Responder, type MemberTask, db } from '../services/supabase';
import { DISASTERS } from '../data/disasters';
import { Play, Square, ShieldAlert, Users, MapPin, Mic } from 'lucide-react';

interface CommanderDashboardProps {
  activeIncident: Incident | null;
  responders: Responder[];
  tasks: MemberTask[];
  currentUser: { empNo: string; name: string };
  availableVoices: SpeechSynthesisVoice[];
  selectedVoiceName: string;
  getCleanVoiceName: (name: string) => string;
  handleVoiceChange: (name: string) => void;
}

export const CommanderDashboard: React.FC<CommanderDashboardProps> = ({
  activeIncident,
  responders,
  tasks,
  currentUser,
  availableVoices,
  selectedVoiceName,
  getCleanVoiceName,
  handleVoiceChange,
}) => {
  const [selectedDisasterKey, setSelectedDisasterKey] = useState('화재');
  const [selectedMode, setSelectedMode] = useState('훈련');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const voicePickerRef = useRef<HTMLDivElement>(null);

  // 1. Declare incident and bulk insert manual tasks
  const handleDeclare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location.trim()) return alert('위치를 입력하세요.');
    
    setLoading(true);
    try {
      const scope = selectedMode === '훈련' ? 'drill' : 'all';

      // DB에서 역할·임무 마스터 조회
      const roles = await db.getDisasterRolesWithTasks(selectedDisasterKey);
      if (!roles.length) throw new Error('임무 데이터가 없습니다. npm run seed 를 먼저 실행하세요.');

      // Call declare incident helper
      const incident = await db.declareIncident(
        selectedDisasterKey,
        selectedMode,
        location.trim(),
        scope,
        currentUser.empNo
      );

      // Construct and bulk insert member tasks from DB
      const bulkTasks: Omit<MemberTask, 'updated_at'>[] = [];
      roles.forEach(role => {
        (role.disaster_tasks ?? [])
          .sort((a, b) => a.task_idx - b.task_idx)
          .forEach(task => {
            bulkTasks.push({
              id: `${incident.id}_${role.role}_${task.task_idx}`,
              incident_id: incident.id,
              emp_no: '',
              role: role.role,
              task_idx: task.task_idx,
              label: task.label,
              done: false,
              done_by: null,
            });
          });
      });

      if (bulkTasks.length > 0) {
        await db.initializeMemberTasks(bulkTasks);
      }
    } catch (err: any) {
      alert('상황 발령 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    if (!activeIncident) return;
    if (!window.confirm('상황을 종료하시겠습니까? 모든 출동 기록과 임무 진행률이 초기화됩니다.')) return;
    
    setLoading(true);
    try {
      await db.closeIncident(activeIncident.id);
    } catch (err: any) {
      alert('상황 종료 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEscalate = async () => {
    if (!activeIncident) return;
    if (!window.confirm('실제 상황으로 승격하시겠습니까? 모든 반원에게 전면 출동 지시가 전달됩니다.')) return;

    setLoading(true);
    try {
      await db.escalateIncident(activeIncident.id, '실제', 'all');
    } catch (err: any) {
      alert('상황 승격 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Progress Calculations
  const totalTasksCount = tasks.length;
  const completedTasksCount = tasks.filter(t => t.done).length;
  const overallProgressPct = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

  // Responders statistics
  const respondersByStatus = (status: Responder['status']) => responders.filter(r => r.status === status);

  return (
    <div className="content">
      {!activeIncident ? (
        // 1. INCIDENT DECLARATION VIEW
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <ShieldAlert color="var(--color-fire)" size={24} style={{ flexShrink: 0 }} />
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '17px', margin: 0, flex: 1 }}>
              신규 비상 상황 발령
            </h3>
            {/* 화자변경 버튼 */}
            <div ref={voicePickerRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowVoicePicker(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: showVoicePicker ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                  border: showVoicePicker ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', padding: '6px 10px',
                  color: showVoicePicker ? '#60a5fa' : 'var(--text-muted)',
                  fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                <Mic size={13} />
                화자변경
              </button>

              {showVoicePicker && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '6px',
                  background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
                  padding: '6px 0', minWidth: '200px', maxHeight: '260px',
                  overflowY: 'auto', zIndex: 200, boxShadow: '0 12px 40px rgba(0,0,0,0.5)'
                }}>
                  <div style={{ padding: '6px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>🎙 TTS 화자 선택</span>
                  </div>
                  {availableVoices.length === 0 ? (
                    <div style={{ padding: '10px 14px', color: '#64748b', fontSize: '13px' }}>사용 가능한 화자 없음</div>
                  ) : (
                    [...availableVoices]
                      .sort((a, b) => getCleanVoiceName(a.name).localeCompare(getCleanVoiceName(b.name), 'ko'))
                      .map(voice => (
                        <button
                          key={voice.name}
                          type="button"
                          onClick={() => { handleVoiceChange(voice.name); setShowVoicePicker(false); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            width: '100%', padding: '9px 14px',
                            background: selectedVoiceName === voice.name ? 'rgba(59,130,246,0.15)' : 'transparent',
                            border: 'none',
                            color: selectedVoiceName === voice.name ? '#60a5fa' : '#e2e8f0',
                            fontSize: '13px', cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          <span style={{ width: '16px', textAlign: 'center' }}>{selectedVoiceName === voice.name ? '✓' : ''}</span>
                          <span>{getCleanVoiceName(voice.name)}</span>
                        </button>
                      ))
                  )}
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleDeclare} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label htmlFor="disaster-select">재난 유형</label>
              <select
                id="disaster-select"
                value={selectedDisasterKey}
                onChange={(e) => setSelectedDisasterKey(e.target.value)}
              >
                {DISASTERS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>발령 구분</label>
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${selectedMode === '훈련' ? 'active' : ''}`}
                  onClick={() => setSelectedMode('훈련')}
                >
                  🎓 훈련상황
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${selectedMode === '실제' ? 'active' : ''}`}
                  onClick={() => setSelectedMode('실제')}
                  style={{ color: selectedMode === '실제' ? 'var(--color-fire)' : '' }}
                >
                  ⚠️ 실제상황
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="location-input">재난 발생 위치</label>
              <input
                id="location-input"
                type="text"
                placeholder="예: 서관 3층 어린이집 옆, 지하 1층 변전실"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-danger" disabled={loading} style={{ marginTop: '10px' }}>
              <Play size={18} fill="white" />
              즉시 비상 발령 (사이렌/임무 생성)
            </button>
          </form>
        </div>
      ) : (
        // 2. ACTIVE INCIDENT MONITORING VIEW
        <>
          <div className="banner alarm-active" style={{
            background: activeIncident.mode === '실제' 
              ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.4) 100%)'
              : 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.3) 100%)',
            borderColor: activeIncident.mode === '실제' ? 'var(--color-fire)' : 'var(--color-water)'
          }}>
            <div className="banner-title" style={{ color: activeIncident.mode === '실제' ? 'var(--color-fire)' : '#60a5fa' }}>
              <ShieldAlert size={22} />
              {activeIncident.mode === '실제' ? '🚨 실제 비상 발령 중' : '🎓 비상 대응 훈련 중'}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, marginTop: '8px', fontFamily: 'var(--font-display)' }}>
              {activeIncident.disaster} 발생
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-muted)', marginTop: '8px' }}>
              <MapPin size={16} />
              <span>위치: <strong>{activeIncident.location}</strong></span>
            </div>
          </div>

          {/* Overall Progress Gauge */}
          <div className="card">
            <div className="progress-header">
              <span>전체 공동 임무 수행률</span>
              <strong style={{ fontSize: '18px', color: 'var(--color-green)' }}>{overallProgressPct}%</strong>
            </div>
            <div className="progress-track" style={{ height: '12px' }}>
              <div
                className="progress-fill"
                style={{
                  width: `${overallProgressPct}%`,
                  background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)'
                }}
              ></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
              <span>완료 임무: {completedTasksCount}건</span>
              <span>총 임무: {totalTasksCount}건</span>
            </div>
          </div>

          {/* Responders stats */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Users size={20} color="var(--color-water)" />
              <h3 style={{ margin: 0, fontSize: '15px' }}>대원 출동 현황 ({responders.length}명 소집)</h3>
            </div>
            
            <div className="cop-grid" style={{ marginBottom: '16px' }}>
              <div className="cop-stat-card">
                <div className="cop-stat-val" style={{ color: 'var(--color-power)' }}>{respondersByStatus('출동중').length}</div>
                <div className="cop-stat-label">출동 중</div>
              </div>
              <div className="cop-stat-card">
                <div className="cop-stat-val" style={{ color: 'var(--color-water)' }}>{respondersByStatus('현장').length}</div>
                <div className="cop-stat-label">현장 도착</div>
              </div>
            </div>

            <div className="roster-grid">
              {responders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                  소집된 대응 대원이 아직 없습니다.
                </div>
              ) : (
                responders.map((resp) => {
                  let dotColor = '#94a3b8'; // 미응답
                  if (resp.status === '출동중') dotColor = 'var(--color-power)';
                  if (resp.status === '현장') dotColor = 'var(--color-water)';
                  if (resp.status === '복귀') dotColor = 'var(--color-green)';
                  
                  return (
                    <div key={resp.emp_no} className="roster-row">
                      <div>
                        <strong style={{ fontSize: '14px' }}>{resp.name}</strong>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                          {resp.team} / {resp.role}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="status-dot" style={{ backgroundColor: dotColor }}></span>
                        <span style={{ fontSize: '13px', fontWeight: 700 }}>{resp.status}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Commander Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {activeIncident.mode === '훈련' && (
              <button onClick={handleEscalate} className="btn btn-secondary" disabled={loading} style={{ borderColor: 'var(--color-fire)', color: 'var(--color-fire)' }}>
                🚨 실제 비상 상황으로 승격
              </button>
            )}
            
            <button onClick={handleClose} className="btn btn-danger" disabled={loading}>
              <Square size={16} fill="white" />
              상황 종료 및 리셋
            </button>
          </div>
        </>
      )}
    </div>
  );
};
