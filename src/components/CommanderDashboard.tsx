import React, { useRef, useState, useMemo } from 'react';
import { type Incident, type Responder, type MemberTask, type EmployeeDB, db } from '../services/supabase';
import { DISASTERS } from '../data/disasters';
import { stopAllAlerts } from '../utils/audio';
import { Play, Square, ShieldAlert, Users, MapPin, Mic, UserCheck, TrendingUp } from 'lucide-react';

// 화재 초기출동조 배지 (감지기동작 시 1차 소집)
const FIRE_INITIAL_BADGES = new Set(['총괄', '상황실', '통제', '출동']);

// 참여인원 모달: 파트장 → 파트로 그룹 통합
const normalizeParticipantTeam = (team: string) =>
  team.endsWith('파트장') ? team.replace('파트장', '파트') : team;

// 교대 여부
const isShiftEmployee = (role: string) => role.includes('교대');

// 그룹 내 정렬: 파트장 → 주간 파트원 → 교대 파트원
const empSortRank = (role: string) =>
  role.startsWith('파트장') || role === '센터장' || role === '상황실' ? 0
  : isShiftEmployee(role) ? 2 : 1;

interface CommanderDashboardProps {
  activeIncident: Incident | null;
  responders: Responder[];
  tasks: MemberTask[];
  currentUser: { empNo: string; name: string };
  employees: EmployeeDB[];
  availableVoices: SpeechSynthesisVoice[];
  selectedVoiceName: string;
  getCleanVoiceName: (name: string) => string;
  handleVoiceChange: (name: string) => void;
}

const TEAM_ORDER = [
  '상황실', '센터장',
  '기계파트', '전기파트', '소방파트',
  '운영파트', '건축파트', '품질/안전파트',
  '보안1', '보안2', '보안3',
  '주차파트', '미화파트',
];

export const CommanderDashboard: React.FC<CommanderDashboardProps> = ({
  activeIncident,
  responders,
  tasks,
  currentUser,
  employees,
  availableVoices,
  selectedVoiceName,
  getCleanVoiceName,
  handleVoiceChange,
}) => {
  const [selectedDisasterKey, setSelectedDisasterKey] = useState('화재');
  const [selectedMode, setSelectedMode] = useState<'훈련' | '실제'>('훈련');
  // 화재 전용 서브모드: 'initial'=감지기동작, 'full'=전체
  const [fireSubMode, setFireSubMode] = useState<'initial' | 'full'>('initial');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const voicePickerRef = useRef<HTMLDivElement>(null);

  // 참여인원 모달
  const [showParticipants, setShowParticipants] = useState(false);
  const [selectedEmps, setSelectedEmps] = useState<Set<string>>(new Set());
  const [savingParticipants, setSavingParticipants] = useState(false);

  const isFireDisaster = selectedDisasterKey === '화재';

  // 직원 목록 팀별 그룹화 (파트장 → 파트에 통합, 주간→교대 순 정렬)
  const groupedEmployees = useMemo(() => {
    const map: Record<string, EmployeeDB[]> = {};
    for (const e of employees) {
      const grp = normalizeParticipantTeam(e.team);
      if (!map[grp]) map[grp] = [];
      map[grp].push(e);
    }
    for (const arr of Object.values(map)) {
      arr.sort((a, b) => empSortRank(a.role) - empSortRank(b.role) || a.name.localeCompare(b.name, 'ko'));
    }
    const ordered: [string, EmployeeDB[]][] = [];
    for (const t of TEAM_ORDER) {
      if (map[t]) ordered.push([t, map[t]]);
    }
    for (const [t, emps] of Object.entries(map)) {
      if (!TEAM_ORDER.includes(t)) ordered.push([t, emps]);
    }
    return ordered;
  }, [employees]);

  // ── 발령 ─────────────────────────────────────────
  const handleDeclare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location.trim()) return alert('위치를 입력하세요.');

    const isInitial = isFireDisaster && fireSubMode === 'initial';
    const modeLabel = isFireDisaster
      ? (selectedMode === '훈련'
          ? (fireSubMode === 'initial' ? '훈련/감지기' : '훈련/전체')
          : (fireSubMode === 'initial' ? '실제/감지기' : '실제/화재'))
      : selectedMode;
    const subLabel = isFireDisaster && fireSubMode === 'initial' ? '초기출동조만 소집' : '전체 대원 소집';

    if (!window.confirm(`[${modeLabel}] ${selectedDisasterKey} 발령하시겠습니까?\n위치: ${location}\n소집: ${subLabel}`)) return;

    setLoading(true);
    try {
      const scope = isInitial ? 'fire_initial' : (selectedMode === '훈련' ? 'drill' : 'all');
      const allRoles = await db.getDisasterRolesWithTasks(selectedDisasterKey);
      if (!allRoles.length) throw new Error('임무 데이터가 없습니다. npm run seed 를 먼저 실행하세요.');

      // 감지기동작이면 초기출동조 역할만 발령
      const roles = isInitial
        ? allRoles.filter(r => FIRE_INITIAL_BADGES.has(r.badge))
        : allRoles;

      const incident = await db.declareIncident(
        selectedDisasterKey, modeLabel, location.trim(), scope, currentUser.empNo
      );

      const bulkTasks: Omit<MemberTask, 'updated_at' | 'done_by'>[] = [];
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
            });
          });
      });

      if (bulkTasks.length > 0) await db.initializeMemberTasks(bulkTasks);

      // 훈련 모드 + 사전 참여인원 설정된 경우 자동 적용
      if (selectedMode === '훈련' && selectedEmps.size > 0) {
        const selected = employees.filter(e => selectedEmps.has(e.emp_no));
        await db.setTrainingParticipants(incident.id, selected, []);
      }
    } catch (err: any) {
      alert('상황 발령 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 화재 전체 승격 (감지기동작 → 전체훈련/화재상황) ─────
  const handleFireEscalate = async () => {
    if (!activeIncident) return;
    const isTraining = activeIncident.mode.startsWith('훈련');
    const newMode = isTraining ? '훈련/전체' : '실제/화재';
    const newScope = isTraining ? 'drill' : 'all';
    const label = isTraining ? '전체훈련' : '화재상황';
    if (!window.confirm(`[${label}]으로 승격하시겠습니까?\n나머지 대원이 추가 소집됩니다.`)) return;

    setLoading(true);
    try {
      // mode + scope 업데이트 (Realtime으로 다른 기기에 TTS 재발령)
      await db.escalateIncident(activeIncident.id, newMode, newScope);

      // 아직 생성되지 않은 역할의 임무만 추가
      const allRoles = await db.getDisasterRolesWithTasks(activeIncident.disaster);
      const existingRoles = new Set(tasks.map(t => t.role));
      const newRoles = allRoles.filter(r => !existingRoles.has(r.role));

      const bulkTasks: Omit<MemberTask, 'updated_at' | 'done_by'>[] = [];
      newRoles.forEach(role => {
        (role.disaster_tasks ?? [])
          .sort((a, b) => a.task_idx - b.task_idx)
          .forEach(task => {
            bulkTasks.push({
              id: `${activeIncident.id}_${role.role}_${task.task_idx}`,
              incident_id: activeIncident.id,
              emp_no: '',
              role: role.role,
              task_idx: task.task_idx,
              label: task.label,
              done: false,
            });
          });
      });

      if (bulkTasks.length > 0) await db.initializeMemberTasks(bulkTasks);
    } catch (err: any) {
      alert('승격 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 상황 종료 ──────────────────────────────────────
  const handleClose = async () => {
    if (!activeIncident) return;
    if (!window.confirm('상황을 종료하시겠습니까? 모든 출동 기록과 임무 진행률이 초기화됩니다.')) return;
    stopAllAlerts();
    setLoading(true);
    try {
      await db.closeIncident(activeIncident.id);
    } catch (err: any) {
      alert('상황 종료 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 참여인원 모달 ───────────────────────────────────
  const openParticipantModal = () => {
    if (activeIncident) {
      // 발령 중: 현재 대원 목록 기준
      setSelectedEmps(new Set(responders.map(r => r.emp_no)));
    } else {
      // 발령 전: 아무도 선택 안 된 경우 전체 선택 기본값
      if (selectedEmps.size === 0) {
        setSelectedEmps(new Set(employees.map(e => e.emp_no)));
      }
    }
    setShowParticipants(true);
  };

  const toggleEmp = (empNo: string) => {
    setSelectedEmps(prev => {
      const next = new Set(prev);
      next.has(empNo) ? next.delete(empNo) : next.add(empNo);
      return next;
    });
  };

  const toggleTeam = (teamEmps: EmployeeDB[]) => {
    const allSelected = teamEmps.every(e => selectedEmps.has(e.emp_no));
    setSelectedEmps(prev => {
      const next = new Set(prev);
      if (allSelected) teamEmps.forEach(e => next.delete(e.emp_no));
      else teamEmps.forEach(e => next.add(e.emp_no));
      return next;
    });
  };

  const saveParticipants = async () => {
    if (!activeIncident) {
      // 발령 전: 선택만 저장하고 닫기 (발령 시 자동 적용)
      setShowParticipants(false);
      return;
    }
    setSavingParticipants(true);
    try {
      const selected = employees.filter(e => selectedEmps.has(e.emp_no));
      await db.setTrainingParticipants(activeIncident.id, selected, responders);
      setShowParticipants(false);
    } catch (err: any) {
      alert('참여인원 저장 오류: ' + err.message);
    } finally {
      setSavingParticipants(false);
    }
  };

  // ── 통계 ────────────────────────────────────────────
  const checkableTasks = tasks.filter(t => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
  const completedTasksCount = checkableTasks.filter(t => t.done).length;
  const overallProgressPct = checkableTasks.length > 0
    ? Math.round((completedTasksCount / checkableTasks.length) * 100) : 0;

  const respondersByStatus = (status: Responder['status']) => responders.filter(r => r.status === status);

  // 활성 발령 정보 파생
  const activeIsTraining = activeIncident?.mode.startsWith('훈련') ?? false;
  const activeIsInitial = activeIncident?.scope === 'fire_initial';
  const activeIsFire = activeIncident?.disaster === '화재';

  return (
    <div className="content">
      {!activeIncident ? (
        // ── 발령 화면 ───────────────────────────────
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
                <Mic size={13} />화자변경
              </button>
              {showVoicePicker && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '6px',
                  background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
                  padding: '6px 0', minWidth: '200px', maxHeight: '260px',
                  overflowY: 'auto', zIndex: 200, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
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
                        <button key={voice.name} type="button"
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
            {/* 재난 유형 */}
            <div>
              <label htmlFor="disaster-select">재난 유형</label>
              <select id="disaster-select" value={selectedDisasterKey}
                onChange={(e) => { setSelectedDisasterKey(e.target.value); setFireSubMode('initial'); }}
              >
                {DISASTERS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>

            {/* 발령 구분 */}
            <div>
              <label>발령 구분</label>
              <div className="segmented-control">
                <button type="button" className={`segmented-btn ${selectedMode === '훈련' ? 'active' : ''}`}
                  onClick={() => setSelectedMode('훈련')}>
                  🎓 훈련상황
                </button>
                <button type="button" className={`segmented-btn ${selectedMode === '실제' ? 'active' : ''}`}
                  onClick={() => setSelectedMode('실제')}
                  style={{ color: selectedMode === '실제' ? 'var(--color-fire)' : '' }}>
                  ⚠️ 실제상황
                </button>
              </div>
            </div>

            {/* 화재 전용: 서브모드 선택 */}
            {isFireDisaster && (
              <div>
                <label>{selectedMode === '훈련' ? '훈련 유형' : '화재 단계'}</label>
                <div className="segmented-control">
                  <button type="button" className={`segmented-btn ${fireSubMode === 'initial' ? 'active' : ''}`}
                    onClick={() => setFireSubMode('initial')}>
                    🔔 감지기동작
                  </button>
                  <button type="button" className={`segmented-btn ${fireSubMode === 'full' ? 'active' : ''}`}
                    onClick={() => setFireSubMode('full')}
                    style={{ color: fireSubMode === 'full' ? (selectedMode === '실제' ? 'var(--color-fire)' : '#a78bfa') : '' }}>
                    {selectedMode === '훈련' ? '🏋️ 전체훈련' : '🔥 화재상황'}
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5 }}>
                  {fireSubMode === 'initial'
                    ? '초기출동조(총괄·상황실·통제·출동)만 소집 → 이후 승격 가능'
                    : (selectedMode === '훈련' ? '전체 대원 즉시 소집' : '전체 대원 즉시 소집')}
                </div>
              </div>
            )}

            {/* 위치 */}
            <div>
              <label htmlFor="location-input">재난 발생 위치</label>
              <input id="location-input" type="text"
                placeholder="예: 서관 3층 어린이집 옆, 지하 1층 변전실"
                value={location} onChange={(e) => setLocation(e.target.value)} required
              />
            </div>

            {/* 훈련 시 참여인원 사전 설정 */}
            {selectedMode === '훈련' && (
              <button type="button" onClick={openParticipantModal} className="btn"
                style={{ borderColor: 'rgba(99,102,241,0.5)', color: '#818cf8', background: 'rgba(99,102,241,0.1)' }}>
                <UserCheck size={18} />
                훈련 참여인원 설정{selectedEmps.size > 0 ? ` (${selectedEmps.size}명 선택됨)` : ''}
              </button>
            )}

            <button type="submit" className="btn btn-danger" disabled={loading} style={{ marginTop: '4px' }}>
              <Play size={18} fill="white" />
              즉시 비상 발령 (사이렌/임무 생성)
            </button>
          </form>
        </div>
      ) : (
        // ── 발령 중 모니터링 ────────────────────────
        <>
          {/* 배너 */}
          <div className="banner alarm-active" style={{
            background: !activeIsTraining
              ? 'linear-gradient(135deg, rgba(239,68,68,0.25) 0%, rgba(220,38,38,0.4) 100%)'
              : 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(37,99,235,0.3) 100%)',
            borderColor: !activeIsTraining ? 'var(--color-fire)' : 'var(--color-water)',
          }}>
            <div className="banner-title" style={{ color: !activeIsTraining ? 'var(--color-fire)' : '#60a5fa' }}>
              <ShieldAlert size={22} />
              {!activeIsTraining ? '🚨 실제 비상 발령 중' : '🎓 비상 대응 훈련 중'}
              {activeIsInitial && <span style={{ fontSize: '12px', background: 'rgba(245,158,11,0.2)', color: '#fbbf24', padding: '2px 8px', borderRadius: '6px', marginLeft: '8px' }}>감지기동작</span>}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, marginTop: '8px', fontFamily: 'var(--font-display)' }}>
              {activeIsTraining ? `${activeIncident.disaster}훈련상황` : `${activeIncident.disaster} 발생`}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-muted)', marginTop: '8px' }}>
              <MapPin size={16} />
              <span>위치: <strong>{activeIncident.location}</strong></span>
            </div>
            {activeIsInitial && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#fbbf24' }}>
                ⚡ 초기출동조 소집 중 — 승격 버튼으로 나머지 대원 소집
              </div>
            )}
          </div>

          {/* 임무 수행률 */}
          <div className="card">
            <div className="progress-header">
              <span>전체 공동 임무 수행률</span>
              <strong style={{ fontSize: '18px', color: 'var(--color-green)' }}>{overallProgressPct}%</strong>
            </div>
            <div className="progress-track" style={{ height: '12px' }}>
              <div className="progress-fill" style={{ width: `${overallProgressPct}%`, background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)' }}></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
              <span>완료 임무: {completedTasksCount}건</span>
              <span>총 임무: {checkableTasks.length}건</span>
            </div>
          </div>

          {/* 대원 현황 */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Users size={20} color="var(--color-water)" />
              <h3 style={{ margin: 0, fontSize: '15px' }}>
                대원 출동 현황 ({responders.length}명{activeIsInitial ? ' · 초기출동조' : ''})
              </h3>
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
                  let dotColor = '#94a3b8';
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

          {/* 지휘관 액션 버튼 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 화재 감지기동작 → 전체 승격 버튼 */}
            {activeIsFire && activeIsInitial && (
              <button onClick={handleFireEscalate} className="btn" disabled={loading}
                style={{
                  background: !activeIsTraining
                    ? 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(220,38,38,0.35))'
                    : 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(79,70,229,0.35))',
                  border: `1px solid ${!activeIsTraining ? 'rgba(239,68,68,0.5)' : 'rgba(99,102,241,0.5)'}`,
                  color: !activeIsTraining ? '#fca5a5' : '#a5b4fc',
                }}
              >
                <TrendingUp size={18} />
                {!activeIsTraining ? '🔥 화재상황으로 승격 (나머지 대원 소집)' : '🏋️ 전체훈련으로 승격 (나머지 대원 소집)'}
              </button>
            )}


            <button onClick={handleClose} className="btn btn-danger" disabled={loading}>
              <Square size={16} fill="white" />
              상황 종료 및 리셋
            </button>
          </div>
        </>
      )}

      {/* ── 참여인원 설정 모달 ──────────────────────────────── */}
      {showParticipants && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        }}>
          <div style={{
            background: 'var(--bg-app)', borderRadius: '24px 24px 0 0',
            maxHeight: '85dvh', display: 'flex', flexDirection: 'column',
            border: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none',
          }}>
            {/* 헤더 */}
            <div style={{ padding: '16px 20px 12px', display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
              <UserCheck size={20} color="#818cf8" style={{ marginRight: '10px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '16px' }}>훈련 참여인원 설정</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{selectedEmps.size}명 선택됨</div>
              </div>
              <button onClick={() => setShowParticipants(false)}
                style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            </div>

            {/* 전체/주간/야간 빠른 선택 */}
            <div style={{ padding: '10px 20px', display: 'flex', gap: '6px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
              <button onClick={() => setSelectedEmps(new Set(employees.map(e => e.emp_no)))}
                style={{ flex: 1, minWidth: '72px', padding: '8px 4px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '10px', color: '#818cf8', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                전체 선택
              </button>
              <button onClick={() => setSelectedEmps(new Set(employees.filter(e => !isShiftEmployee(e.role)).map(e => e.emp_no)))}
                style={{ flex: 1, minWidth: '72px', padding: '8px 4px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '10px', color: '#fbbf24', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                ☀️ 주간 선택
              </button>
              <button onClick={() => setSelectedEmps(new Set(employees.filter(e => isShiftEmployee(e.role)).map(e => e.emp_no)))}
                style={{ flex: 1, minWidth: '72px', padding: '8px 4px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '10px', color: '#94a3b8', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                🌙 야간/교대
              </button>
              <button onClick={() => setSelectedEmps(new Set())}
                style={{ flex: 1, minWidth: '72px', padding: '8px 4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                전체 해제
              </button>
            </div>

            {/* 직원 목록 */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '8px 16px 16px' }}>
              {groupedEmployees.map(([team, emps]) => {
                const allChecked = emps.every(e => selectedEmps.has(e.emp_no));
                const someChecked = emps.some(e => selectedEmps.has(e.emp_no));
                return (
                  <div key={team} style={{ marginBottom: '8px' }}>
                    <div onClick={() => toggleTeam(emps)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', cursor: 'pointer', marginBottom: '2px' }}>
                      <div style={{ width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0, border: `2px solid ${allChecked ? '#818cf8' : someChecked ? '#818cf8' : 'rgba(255,255,255,0.2)'}`, background: allChecked ? '#818cf8' : someChecked ? 'rgba(129,140,248,0.3)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {allChecked && <span style={{ color: 'white', fontSize: '12px', lineHeight: 1 }}>✓</span>}
                        {!allChecked && someChecked && <span style={{ color: '#818cf8', fontSize: '12px', lineHeight: 1 }}>−</span>}
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 700, flex: 1 }}>{team}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {emps.filter(e => selectedEmps.has(e.emp_no)).length}/{emps.length}명
                      </span>
                    </div>
                    {emps.map((emp, idx) => {
                      const checked = selectedEmps.has(emp.emp_no);
                      const responded = responders.find(r => r.emp_no === emp.emp_no);
                      const isActive = responded && responded.status !== '미응답';
                      const shift = isShiftEmployee(emp.role);
                      const prevShift = idx > 0 ? isShiftEmployee(emps[idx - 1].role) : false;
                      const showShiftDivider = shift && !prevShift;
                      return (
                        <React.Fragment key={emp.emp_no}>
                          {showShiftDivider && (
                            <div style={{ padding: '4px 36px 2px', fontSize: '10px', color: '#64748b', fontWeight: 700, letterSpacing: '0.5px' }}>
                              🌙 야간 / 교대
                            </div>
                          )}
                          <div onClick={() => !isActive && toggleEmp(emp.emp_no)}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 12px 7px 36px', borderRadius: '8px', cursor: isActive ? 'default' : 'pointer', opacity: isActive ? 0.8 : 1 }}>
                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, border: `2px solid ${checked ? '#818cf8' : 'rgba(255,255,255,0.2)'}`, background: checked ? '#818cf8' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {checked && <span style={{ color: 'white', fontSize: '11px', lineHeight: 1 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: '14px', flex: 1 }}>{emp.name}</span>
                            <span style={{ fontSize: '11px', color: shift ? '#64748b' : 'var(--text-muted)' }}>{emp.role}</span>
                            {responded && (
                              <span style={{ fontSize: '11px', fontWeight: 700, color: isActive ? 'var(--color-green)' : '#94a3b8', background: isActive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '6px' }}>
                                {responded.status}
                              </span>
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* 저장 버튼 */}
            <div style={{ padding: '12px 16px 20px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button onClick={saveParticipants} disabled={savingParticipants} className="btn btn-primary">
                {savingParticipants
                  ? '저장 중...'
                  : activeIncident
                    ? `💾 ${selectedEmps.size}명 참여인원 확정`
                    : `✅ ${selectedEmps.size}명 선택 완료 (발령 시 자동 적용)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
