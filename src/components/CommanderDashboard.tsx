import React, { useRef, useState, useMemo } from 'react';
import { type Incident, type Responder, type MemberTask, type EmployeeDB, db } from '../services/supabase';
import { DISASTERS } from '../data/disasters';
import { stopAllAlerts } from '../utils/audio';
import { Play, Square, ShieldAlert, Users, Mic, UserCheck, BarChart2, Monitor } from 'lucide-react';

// 화재 초기출동조 배지 (감지기동작 시 1차 소집)
const FIRE_INITIAL_BADGES = new Set(['총괄', '상황실', '통제', '출동']);

// 참여인원 모달: 파트장 → 파트로, 교대 직원 → 상황실로 통합
const normalizeParticipantTeam = (team: string, role: string) =>
  isShiftEmployee(role) ? '상황실'
  : team.endsWith('파트장') ? team.replace('파트장', '파트') : team;

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
  isCommander: boolean;
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
  isCommander,
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

  // 참여인원 인라인 패널
  const [showParticipants, setShowParticipants] = useState(false);
  const [selectedEmps, setSelectedEmps] = useState<Set<string>>(new Set());
  const [expandedCell, setExpandedCell] = useState<{ team: string; type: 'day' | 'A' | 'B' | 'C' | 'D' } | null>(null);
  const [shiftExpanded, setShiftExpanded] = useState(false);

  // 전체훈련 승격 시 나머지 대원 선택
  const [escalateEmps, setEscalateEmps] = useState<Set<string>>(new Set());
  const [showEscalatePanel, setShowEscalatePanel] = useState(false);

  // 대원 출동현황 아코디언
  const [showResponders, setShowResponders] = useState(true);
  const isFireDisaster = selectedDisasterKey === '화재';


  // 직원 목록 팀별 그룹화 (파트장 → 파트에 통합, 주간→교대 순 정렬)
  const groupedEmployees = useMemo(() => {
    const map: Record<string, EmployeeDB[]> = {};
    for (const e of employees) {
      const grp = normalizeParticipantTeam(e.team, e.role);
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
    if (selectedMode === '훈련' && selectedEmps.size === 0) return alert('참여인원을 선택해주세요.');

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
        // 승격 패널 선택을 직전 훈련 참여인원과 동일하게 이어받음 + 패널 자동 오픈
        setEscalateEmps(new Set(selectedEmps));
        setShowEscalatePanel(true);
      } else {
        setEscalateEmps(new Set());
        setShowEscalatePanel(false);
      }

      // FCM 직접 호출 (pg_net 트리거 백업)
      await db.sendIncidentPush(incident, 'INSERT');
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

    // 훈련이고 선택 대원이 있으면 drill_emp_nos 설정
    const drillEmpNos = isTraining && escalateEmps.size > 0
      ? [...escalateEmps].join(',')
      : null;

    const participantDesc = isTraining
      ? (escalateEmps.size > 0 ? `선택 대원 ${escalateEmps.size}명` : '나머지 전원')
      : '나머지 대원 전원';

    if (!window.confirm(`[${label}]으로 승격하시겠습니까?\n소집: ${participantDesc}`)) return;

    setLoading(true);
    try {
      await db.escalateIncident(activeIncident.id, newMode, newScope, drillEmpNos);

      // 선택 대원을 responders에 추가 (훈련 + 선택 대원 있을 때)
      if (isTraining && escalateEmps.size > 0) {
        const selectedEmployees = employees.filter(e => escalateEmps.has(e.emp_no));
        await db.setTrainingParticipants(activeIncident.id, selectedEmployees, responders);
      }

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

      // FCM 직접 호출 (pg_net 트리거 백업 + drill_emp_nos 필터)
      await db.sendIncidentPush(
        { ...activeIncident, mode: newMode, scope: newScope, drill_emp_nos: drillEmpNos },
        'UPDATE',
        activeIncident,
        drillEmpNos
      );
    } catch (err: any) {
      alert('승격 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 상황 종료 ──────────────────────────────────────
  const handleClose = async () => {
    if (!activeIncident) return;
    if (!window.confirm('상황을 종료하고 리셋하시겠습니까?\n✔ 대원 출동 현황 초기화\n✔ 임무 체크리스트 전체 해제')) return;
    stopAllAlerts();
    setLoading(true);
    try {
      await db.closeIncident(activeIncident.id);
      setSelectedEmps(new Set());
      setShowParticipants(false);
    } catch (err: any) {
      alert('상황 종료 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setLoading(false);
    }
  };


  // ── 통계 ────────────────────────────────────────────
  const checkableTasks = tasks.filter(t => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
  const completedTasksCount = checkableTasks.filter(t => t.done).length;
  const overallProgressPct = checkableTasks.length > 0
    ? Math.round((completedTasksCount / checkableTasks.length) * 100) : 0;

  // name/emp_no 비어있는 ghost 항목 제외
  const validResponders = responders.filter(r => r.emp_no && r.name);
  const respondersByStatus = (status: Responder['status']) => validResponders.filter(r => r.status === status);

  // 활성 발령 정보 파생
  const activeIsTraining = activeIncident?.mode.startsWith('훈련') ?? false;
  const activeIsInitial = activeIncident?.scope === 'fire_initial';
  const activeIsFire = activeIncident?.disaster === '화재';

  return (
    <div className="content">
      {!activeIncident ? (
        // ── 발령 화면 (지휘관만) / 대기 화면 (일반 대원) ──
        !isCommander ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <Monitor size={36} color="#334155" style={{ marginBottom: '12px' }} />
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#475569' }}>공동 상황판 대기중</div>
            <div style={{ fontSize: '13px', marginTop: '6px' }}>발령이 시작되면 여기에 대원 현황이 표시됩니다.</div>
          </div>
        ) : (
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
                    {selectedMode === '훈련' ? '🎯 전체훈련' : '🔥 화재상황'}
                  </button>
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

            {/* 훈련 시 참여인원 — 인라인 그리드 */}
            {selectedMode === '훈련' && (
              <div>
                <button type="button"
                  onClick={() => setShowParticipants(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                    border: '1px solid rgba(99,102,241,0.4)',
                    background: showParticipants ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.08)',
                    color: '#818cf8', fontSize: '13px', fontWeight: 700,
                  }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserCheck size={16} />
                    훈련 참여인원 설정
                  </span>
                  <span style={{ fontSize: '12px', opacity: 0.8 }}>
                    {selectedEmps.size > 0 ? `${selectedEmps.size}명 선택됨` : '미설정'} {showParticipants ? '▲' : '▼'}
                  </span>
                </button>

                {showParticipants && (
                  <div style={{ marginTop: '6px', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '10px', overflow: 'hidden', background: 'rgba(15,23,42,0.7)' }}>
                    {/* 빠른 선택 */}
                    <div style={{ display: 'flex', gap: '4px', padding: '7px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {(() => {
                        const togSel = (ids: string[]) => {
                          const allSel = ids.length > 0 && ids.every(id => selectedEmps.has(id));
                          setSelectedEmps(allSel ? new Set() : new Set(ids));
                          setShiftExpanded(false);
                        };
                        const shiftIds = (cho: string) => employees.filter(e => isShiftEmployee(e.role) && e.role.includes(cho + '조')).map(e => e.emp_no);
                        const togGroupSel = (ids: string[]) => {
                          const allSel = ids.length > 0 && ids.every(id => selectedEmps.has(id));
                          setSelectedEmps(prev => {
                            const next = new Set(prev);
                            if (allSel) ids.forEach(id => next.delete(id));
                            else ids.forEach(id => next.add(id));
                            return next;
                          });
                        };
                        const allShiftIds = employees.filter(e => isShiftEmployee(e.role)).map(e => e.emp_no);
                        const toggleShift = () => {
                          if (shiftExpanded) {
                            setShiftExpanded(false);
                            setSelectedEmps(prev => { const next = new Set(prev); allShiftIds.forEach(id => next.delete(id)); return next; });
                          } else {
                            setShiftExpanded(true);
                            setSelectedEmps(prev => { const next = new Set(prev); allShiftIds.forEach(id => next.add(id)); return next; });
                          }
                        };
                        return [
                          { label: '전체', color: '#818cf8', fn: () => togSel(employees.map(e => e.emp_no)) },
                          { label: '☀️ 주간', color: '#fbbf24', fn: () => togSel(employees.filter(e => !isShiftEmployee(e.role)).map(e => e.emp_no)) },
                          { label: '🌙 교대', color: shiftExpanded ? '#c084fc' : '#a5b4fc', fn: toggleShift },
                          ...(shiftExpanded ? [
                            { label: 'A조', color: '#a5b4fc', fn: () => togGroupSel(shiftIds('A')) },
                            { label: 'B조', color: '#86efac', fn: () => togGroupSel(shiftIds('B')) },
                            { label: 'C조', color: '#fdba74', fn: () => togGroupSel(shiftIds('C')) },
                            { label: 'D조', color: '#f9a8d4', fn: () => togGroupSel(shiftIds('D')) },
                          ] : []),
                        ].map(({ label, fn, color }) => (
                          <button key={label} type="button" onClick={fn} style={{
                            flex: 1, padding: '5px 0', borderRadius: '6px', cursor: 'pointer',
                            border: `1px solid ${color}44`, background: `${color}14`,
                            color, fontSize: '11px', fontWeight: 700,
                          }}>{label}</button>
                        ));
                      })()}
                    </div>

                    {/* 파트 × 주간/A~D조 그리드 */}
                    <div style={{ padding: '0 8px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 54px 38px 38px 38px 38px', padding: '5px 4px 3px', fontSize: '10px', color: '#475569', fontWeight: 700 }}>
                        <span />
                        <span>파트</span>
                        <span style={{ textAlign: 'center' }}>☀️ 주간</span>
                        <span style={{ textAlign: 'center', color: '#a5b4fc' }}>A</span>
                        <span style={{ textAlign: 'center', color: '#86efac' }}>B</span>
                        <span style={{ textAlign: 'center', color: '#fdba74' }}>C</span>
                        <span style={{ textAlign: 'center', color: '#f9a8d4' }}>D</span>
                      </div>
                      {groupedEmployees.map(([team, emps]) => {
                        const dayEmps = emps.filter(e => !isShiftEmployee(e.role));
                        const shiftOf = (cho: string) => emps.filter(e => isShiftEmployee(e.role) && e.role.includes(cho + '조'));
                        const aEmps = shiftOf('A'), bEmps = shiftOf('B'), cEmps = shiftOf('C'), dEmps = shiftOf('D');
                        const cnt = (g: EmployeeDB[]) => g.filter(e => selectedEmps.has(e.emp_no)).length;

                        const toggleGroup = (grp: EmployeeDB[]) => {
                          const all = grp.every(e => selectedEmps.has(e.emp_no));
                          setSelectedEmps(prev => {
                            const next = new Set(prev);
                            if (all) grp.forEach(e => next.delete(e.emp_no));
                            else grp.forEach(e => next.add(e.emp_no));
                            return next;
                          });
                        };
                        const toggleOne = (empNo: string) => {
                          setSelectedEmps(prev => {
                            const next = new Set(prev);
                            next.has(empNo) ? next.delete(empNo) : next.add(empNo);
                            return next;
                          });
                        };
                        const isExp = (t: string) => expandedCell?.team === team && expandedCell.type === t;

                        const cell = (n: number, total: number, type: 'day'|'A'|'B'|'C'|'D', color: string) => {
                          if (!total) return <span />;
                          const exp = isExp(type);
                          return (
                            <button type="button" onClick={() => setExpandedCell(exp ? null : { team, type })} style={{
                              margin: '2px', padding: '3px 0', borderRadius: '6px',
                              fontSize: '10px', fontWeight: 700, textAlign: 'center', cursor: 'pointer',
                              border: exp ? `2px solid ${color}` : `1px solid ${n > 0 ? color + '66' : 'rgba(255,255,255,0.08)'}`,
                              background: exp ? color + '33' : n === total ? color + '22' : n > 0 ? color + '0d' : 'rgba(255,255,255,0.03)',
                              color: n > 0 ? color : '#334155',
                            }}>{n}/{total}</button>
                          );
                        };
                        const subList = (grp: EmployeeDB[], label: string, color: string) => {
                          const allSel = grp.every(e => selectedEmps.has(e.emp_no));
                          return (
                            <div style={{ background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '6px 10px 8px' }}>
                              <div onClick={() => toggleGroup(grp)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 2px 7px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '5px' }}>
                                <span style={{ fontSize: '11px', color, fontWeight: 700 }}>{team} · {label}</span>
                                <span style={{ fontSize: '10px', color: allSel ? color : '#475569', fontWeight: 600 }}>{allSel ? '전체 해제' : '전체 선택'}</span>
                              </div>
                              {grp.map(emp => {
                                const checked = selectedEmps.has(emp.emp_no);
                                return (
                                  <div key={emp.emp_no} onClick={() => toggleOne(emp.emp_no)} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 2px', cursor: 'pointer' }}>
                                    <div style={{ width: '15px', height: '15px', borderRadius: '4px', flexShrink: 0, border: `2px solid ${checked ? color : 'rgba(255,255,255,0.18)'}`, background: checked ? color + '33' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      {checked && <span style={{ color, fontSize: '10px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                                    </div>
                                    <span style={{ fontSize: '12px', flex: 1, color: checked ? '#e2e8f0' : '#94a3b8' }}>{emp.name}</span>
                                    <span style={{ fontSize: '10px', color: '#475569' }}>{emp.role}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        };

                        const allInTeam = [...dayEmps, ...aEmps, ...bEmps, ...cEmps, ...dEmps];
                        const allTeamSel = allInTeam.length > 0 && allInTeam.every(e => selectedEmps.has(e.emp_no));
                        const someTeamSel = !allTeamSel && allInTeam.some(e => selectedEmps.has(e.emp_no));
                        return (
                          <React.Fragment key={team}>
                            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 54px 38px 38px 38px 38px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <div onClick={() => toggleGroup(allInTeam)} style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, border: `2px solid ${allTeamSel || someTeamSel ? '#818cf8' : 'rgba(255,255,255,0.18)'}`, background: allTeamSel ? '#818cf8' : someTeamSel ? '#818cf844' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', margin: '0 auto' }}>
                                {allTeamSel && <span style={{ color: 'white', fontSize: '9px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                                {someTeamSel && <span style={{ color: '#818cf8', fontSize: '10px', lineHeight: 1, fontWeight: 900 }}>−</span>}
                              </div>
                              <span style={{ fontSize: '11px', color: '#64748b', padding: '0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team}</span>
                              {cell(cnt(dayEmps), dayEmps.length, 'day', '#fbbf24')}
                              {cell(cnt(aEmps), aEmps.length, 'A', '#a5b4fc')}
                              {cell(cnt(bEmps), bEmps.length, 'B', '#86efac')}
                              {cell(cnt(cEmps), cEmps.length, 'C', '#fdba74')}
                              {cell(cnt(dEmps), dEmps.length, 'D', '#f9a8d4')}
                            </div>
                            {isExp('day') && dayEmps.length > 0 && subList(dayEmps, '☀️ 주간', '#fbbf24')}
                            {isExp('A') && aEmps.length > 0 && subList(aEmps, '🌙 A조', '#a5b4fc')}
                            {isExp('B') && bEmps.length > 0 && subList(bEmps, '🌙 B조', '#86efac')}
                            {isExp('C') && cEmps.length > 0 && subList(cEmps, '🌙 C조', '#fdba74')}
                            {isExp('D') && dEmps.length > 0 && subList(dEmps, '🌙 D조', '#f9a8d4')}
                          </React.Fragment>
                        );
                      })}
                    </div>
                    <div style={{ padding: '5px 12px 7px', textAlign: 'right', fontSize: '11px', color: '#64748b' }}>
                      총 <strong style={{ color: '#e2e8f0' }}>{selectedEmps.size}명</strong> 선택
                    </div>
                  </div>
                )}
              </div>
            )}

            <button type="submit" className="btn btn-danger" disabled={loading} style={{ marginTop: '4px' }}>
              <Play size={18} fill="white" />
              즉시 비상 발령 (사이렌/임무 생성)
            </button>
          </form>
        </div>
        )
      ) : (
        // ── 발령 중 모니터링 ────────────────────────
        <>
          {/* 임무 수행률 */}
          <div className="card">
            <div className="progress-header">
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BarChart2 size={15} color="var(--color-green)" />
                업무 수행율
              </span>
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

          {/* 대원 현황 — 아코디언 */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* 헤더 (항상 표시) */}
            <div
              className="accordion-header"
              onClick={() => setShowResponders(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '14px 16px',
                borderBottom: showResponders ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
            >
              <Users size={18} color="var(--color-water)" />
              <span style={{ flex: 1, fontSize: '14px', fontWeight: 700 }}>
                대원 출동 현황
                {activeIsInitial && <span style={{ fontSize: '11px', color: '#fbbf24', marginLeft: '6px' }}>초기출동조</span>}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-power)', fontWeight: 700 }}>
                  출동 {respondersByStatus('출동중').length}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--color-water)', fontWeight: 700 }}>
                  현장 {respondersByStatus('현장').length}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  총 {validResponders.length}명
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {showResponders ? '▲' : '▼'}
                </span>
              </div>
            </div>

            {/* 펼쳐진 내용 */}
            {showResponders && (
              <div style={{ padding: '12px 16px' }}>
                <div className="roster-grid">
                  {validResponders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                      소집된 대응 대원이 아직 없습니다.
                    </div>
                  ) : (
                    validResponders.map((resp) => {
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
            )}
          </div>


          {/* 지휘관 전용 액션 버튼 */}
          {isCommander && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* 화재 감지기동작 → 전체 승격 + 나머지 대원 선택 */}
              {activeIsFire && activeIsInitial && (
                <>
                  {/* 훈련 시: 나머지 대원 선택 패널 */}
                  {activeIsTraining && (
                    <div>
                      <button type="button"
                        onClick={() => setShowEscalatePanel(v => !v)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                          border: '1px solid rgba(165,180,252,0.4)',
                          background: showEscalatePanel ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.08)',
                          color: '#a5b4fc', fontSize: '13px', fontWeight: 700,
                        }}>
                        <span>선택 : 2차 소집 대원</span>
                        <span style={{ fontSize: '12px', opacity: 0.8 }}>
                          {escalateEmps.size}명 / {employees.length}명 {showEscalatePanel ? '▲' : '▼'}
                        </span>
                      </button>

                      {showEscalatePanel && (
                        <div style={{ marginTop: '6px', border: '1px solid rgba(165,180,252,0.2)', borderRadius: '10px', overflow: 'hidden', background: 'rgba(15,23,42,0.7)' }}>
                          {/* 빠른 선택 */}
                          <div style={{ display: 'flex', gap: '4px', padding: '7px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <button type="button"
                              onClick={() => setEscalateEmps(new Set(employees.map(e => e.emp_no)))}
                              style={{ flex: 1, padding: '5px 0', borderRadius: '6px', cursor: 'pointer', border: '1px solid #a5b4fc44', background: '#a5b4fc14', color: '#a5b4fc', fontSize: '11px', fontWeight: 700 }}>
                              전체 선택
                            </button>
                            <button type="button"
                              onClick={() => setEscalateEmps(new Set())}
                              style={{ flex: 1, padding: '5px 0', borderRadius: '6px', cursor: 'pointer', border: '1px solid #94a3b844', background: '#94a3b814', color: '#94a3b8', fontSize: '11px', fontWeight: 700 }}>
                              전체 해제
                            </button>
                          </div>

                          {/* 팀별 직원 목록 — groupedEmployees 재사용 (직전 훈련참여 선택 연동) */}
                          <div style={{ maxHeight: '220px', overflowY: 'auto', padding: '4px 8px 4px' }}>
                            {groupedEmployees.map(([team, teamEmps]) => {
                              const allSel = teamEmps.length > 0 && teamEmps.every(e => escalateEmps.has(e.emp_no));
                              const someSel = !allSel && teamEmps.some(e => escalateEmps.has(e.emp_no));
                              const toggleTeam = () => setEscalateEmps(prev => {
                                const next = new Set(prev);
                                if (allSel) teamEmps.forEach(e => next.delete(e.emp_no));
                                else teamEmps.forEach(e => next.add(e.emp_no));
                                return next;
                              });
                              return (
                                <div key={team} style={{ marginBottom: '2px' }}>
                                  <div onClick={toggleTeam} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 4px', cursor: 'pointer' }}>
                                    <div style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, border: `2px solid ${allSel || someSel ? '#a5b4fc' : 'rgba(255,255,255,0.18)'}`, background: allSel ? '#a5b4fc' : someSel ? '#a5b4fc44' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      {allSel && <span style={{ color: 'white', fontSize: '9px', fontWeight: 900 }}>✓</span>}
                                      {someSel && <span style={{ color: '#a5b4fc', fontSize: '10px', fontWeight: 900 }}>−</span>}
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', flex: 1 }}>{team}</span>
                                    <span style={{ fontSize: '10px', color: '#475569' }}>{teamEmps.filter(e => escalateEmps.has(e.emp_no)).length}/{teamEmps.length}</span>
                                  </div>
                                  {teamEmps.map(emp => {
                                    const checked = escalateEmps.has(emp.emp_no);
                                    return (
                                      <div key={emp.emp_no}
                                        onClick={() => setEscalateEmps(prev => { const next = new Set(prev); next.has(emp.emp_no) ? next.delete(emp.emp_no) : next.add(emp.emp_no); return next; })}
                                        style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '4px 4px 4px 24px', cursor: 'pointer' }}>
                                        <div style={{ width: '13px', height: '13px', borderRadius: '3px', flexShrink: 0, border: `2px solid ${checked ? '#a5b4fc' : 'rgba(255,255,255,0.18)'}`, background: checked ? '#a5b4fc33' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          {checked && <span style={{ color: '#a5b4fc', fontSize: '9px', fontWeight: 900 }}>✓</span>}
                                        </div>
                                        <span style={{ fontSize: '12px', flex: 1, color: checked ? '#e2e8f0' : '#64748b' }}>{emp.name}</span>
                                        <span style={{ fontSize: '10px', color: '#475569' }}>{emp.role}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ padding: '5px 12px 7px', textAlign: 'right', fontSize: '11px', color: '#64748b' }}>
                            <strong style={{ color: '#e2e8f0' }}>{escalateEmps.size}명</strong> 선택 (선택 대원에게만 알람 발송)
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button onClick={handleFireEscalate} className="btn" disabled={loading}
                    style={{
                      background: !activeIsTraining
                        ? 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(220,38,38,0.35))'
                        : 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(79,70,229,0.35))',
                      border: `1px solid ${!activeIsTraining ? 'rgba(239,68,68,0.5)' : 'rgba(99,102,241,0.5)'}`,
                      color: !activeIsTraining ? '#fca5a5' : '#a5b4fc',
                    }}
                  >
                    {!activeIsTraining ? '🔥 화재상황으로 승격 (나머지 대원 소집)' : '🎯 2차 출동 발령'}
                  </button>
                </>
              )}

              <button onClick={handleClose} className="btn" disabled={loading} style={{
                background: 'transparent',
                border: '2px solid var(--color-fire)',
                color: 'var(--color-fire)',
              }}>
                <Square size={16} fill="var(--color-fire)" />
                상황 종료 및 리셋
              </button>
            </div>
          )}
        </>
      )}

    </div>
  );
};
