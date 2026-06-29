import React, { useRef, useState, useMemo } from 'react';
import { type Incident, type Responder, type MemberTask, type EmployeeDB, db, supabase } from '../services/supabase';
import { DISASTERS } from '../data/disasters';
import { stopAllAlerts } from '../utils/audio';
import { Play, Square, ShieldAlert, Users, Mic, UserCheck, BarChart2, Monitor, History, X, ChevronDown } from 'lucide-react';

// 화재 초기출동조 배지 (감지기동작 시 1차 소집)
const FIRE_INITIAL_BADGES = new Set(['총괄', '상황실', '통제', '출동']);

// 참여인원 모달: 파트장 → 파트로, 교대 직원 → 상황실로 통합
const normalizeParticipantTeam = (team: string, role: string) =>
  isShiftEmployee(role) ? '상황실'
  : team.endsWith('파트장') ? team.replace('파트장', '파트') : team;

// 교대 여부
const isShiftEmployee = (role: string) => role.includes('교대');


const INCIDENT_GROUPS = [
  { key: '지휘연락', label: '지휘연락', color: '#f59e0b' },
  { key: '현장대응', label: '현장대응', color: '#ef4444' },
  { key: '대피지원', label: '대피지원', color: '#60a5fa' },
  { key: '교대',    label: '교대',    color: '#c084fc' },
] as const;
type IncidentGroupKey = typeof INCIDENT_GROUPS[number]['key'];

// 재난별 지휘연락반 파트장 팀 목록 (상황실·센터장은 항상 지휘연락)
const CMD_TEAMS: Record<string, string[]> = {
  '화재':     ['소방파트장'],
  '정전':     ['전기파트장'],
  '누수':     ['기계파트장'],
  '태풍/홍수': ['소방파트장'],
  '폭설':     ['운영파트장'],
  '지진':     ['소방파트장'],
  '가스누출':  ['기계파트장'],
  '승강기':   [],
  '테러':     [],
};

// 재난별 대피지원반 팀 목록
const EVAC_TEAMS: Record<string, string[]> = {
  '화재':     ['보안1', '보안2', '보안3', '운영파트장', '운영파트', '주차파트', '품질/안전파트', '미화파트'],
  '정전':     ['보안1', '보안2', '보안3', '운영파트장', '운영파트', '미화파트', '주차파트'],
  '누수':     ['보안1', '보안2', '보안3', '운영파트장', '운영파트'],
  '태풍/홍수': ['보안1', '보안2', '보안3', '소방파트장', '소방파트', '운영파트장', '운영파트'],
  '폭설':     ['미화파트', '보안1', '보안2', '보안3', '주차파트'],
  '지진':     ['보안1', '보안2', '보안3', '운영파트장', '운영파트'],
  '가스누출':  ['건축파트장', '건축파트', '보안1', '보안2', '보안3', '미화파트'],
  '승강기':   ['보안1', '보안2', '보안3', '미화파트'],
  '테러':     ['운영파트장', '운영파트', '건축파트장', '건축파트'],
};

const getIncidentGroup = (e: EmployeeDB, disasterKey: string): IncidentGroupKey => {
  if (isShiftEmployee(e.role)) return '교대';
  const { team } = e;
  if (team === '상황실' || team === '센터장') return '지휘연락';
  if ((CMD_TEAMS[disasterKey] ?? []).includes(team)) return '지휘연락';
  if ((EVAC_TEAMS[disasterKey] ?? []).includes(team)) return '대피지원';
  return '현장대응';
};

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
  const [openAccordions, setOpenAccordions] = useState<Set<string>>(new Set());

  // 전체훈련 승격 시 나머지 대원 선택
  const [escalateEmps, setEscalateEmps] = useState<Set<string>>(new Set());
  const [showEscalatePanel, setShowEscalatePanel] = useState(false);

  // 대원 출동현황 아코디언
  const [showResponders, setShowResponders] = useState(true);
  const [openEscalateAccordions, setOpenEscalateAccordions] = useState<Set<string>>(new Set());
  // 모니터링 탭: 출동현황 | 활동기록 | AI보고서
  const [activeMonitorTab, setActiveMonitorTab] = useState<'roster' | 'log' | 'ai'>('roster');
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const isFireDisaster = selectedDisasterKey === '화재';

  // ── 종료 재난 로그 ───────────────────────────────────────────
  const [showLog, setShowLog] = useState(false);
  const [logIncidents, setLogIncidents] = useState<import('../services/supabase').Incident[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logDetail, setLogDetail] = useState<{
    responders: import('../services/supabase').Responder[];
    tasks: import('../services/supabase').MemberTask[];
  } | null>(null);
  const [logDetailLoading, setLogDetailLoading] = useState(false);
  // 로그 서브 아코디언: Record<incidentId, Record<sectionKey, isOpen>>
  const [logSubOpen, setLogSubOpen] = useState<Record<string, Record<string, boolean>>>({});
  const isSubOpen = (incId: string, sec: string) => logSubOpen[incId]?.[sec] !== false;
  const toggleSub = (incId: string, sec: string) =>
    setLogSubOpen(p => ({ ...p, [incId]: { ...p[incId], [sec]: !isSubOpen(incId, sec) } }));

  const loadLog = async () => {
    setLogLoading(true);
    try {
      const list = await db.getClosedIncidents();
      setLogIncidents(list);
      setShowLog(true);
    } catch (e: any) {
      alert('기록 로드 실패: ' + e.message);
    } finally {
      setLogLoading(false);
    }
  };

  const loadLogDetail = async (incidentId: string) => {
    if (expandedLogId === incidentId) { setExpandedLogId(null); return; }
    setExpandedLogId(incidentId);
    setLogDetail(null);
    setLogDetailLoading(true);
    try {
      const [responders, tasks] = await Promise.all([
        db.getIncidentResponders(incidentId),
        db.getIncidentTasks(incidentId),
      ]);
      setLogDetail({ responders, tasks });
    } catch (e: any) {
      alert('상세 로드 실패: ' + e.message);
    } finally {
      setLogDetailLoading(false);
    }
  };

  const fmtDate = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const fmtDateFull = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const generateAIReport = async () => {
    if (!activeIncident) return;
    setAiLoading(true);
    setAiReport(null);
    setActiveMonitorTab('ai');
    try {
      const { data, error } = await supabase.functions.invoke('generate-report', {
        body: { incident: activeIncident, responders: validResponders, tasks, activityLog },
      });
      if (error) throw error;
      setAiReport(data.report ?? '보고서를 생성할 수 없습니다.');
    } catch (e: any) {
      setAiReport('오류: ' + (e.message ?? String(e)));
    } finally {
      setAiLoading(false);
    }
  };

  const fmtTime = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const downloadReport = (inc: import('../services/supabase').Incident) => {
    if (!logDetail) return;
    const getN = (empNo: string | null | undefined) =>
      employees.find(e => e.emp_no === empNo)?.name ?? (empNo || '—');
    const checkable = logDetail.tasks.filter(t => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
    const done = checkable.filter(t => t.done);
    const pct = checkable.length > 0 ? Math.round(done.length / checkable.length * 100) : 0;
    const roleGroups: Record<string, typeof logDetail.tasks> = {};
    for (const t of checkable) { (roleGroups[t.role] ??= []).push(t); }
    const ord = ['현장','복귀','출동중','미응답'];
    const sortedResp = [...logDetail.responders].sort((a,b) => ord.indexOf(a.status) - ord.indexOf(b.status));
    const stColor = (s: string) => s==='현장'?'#1565c0':s==='복귀'?'#2e7d32':s==='출동중'?'#e65100':'#9e9e9e';

    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>재난 대응 보고서</title>
<style>
  body{font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:10pt;margin:40px;color:#111}
  h1{font-size:16pt;border-bottom:3px solid #1a237e;padding-bottom:8px;color:#1a237e;margin-bottom:16px}
  h2{font-size:12pt;background:#e8eaf6;padding:5px 10px;margin-top:20px;border-left:4px solid #3f51b5;color:#1a237e}
  h3{font-size:10pt;margin:10px 0 4px;color:#37474f;border-bottom:1px solid #ccc;padding-bottom:2px}
  table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.5pt}
  th{background:#e3f2fd;border:1px solid #90caf9;padding:5px 8px;text-align:left;font-weight:bold}
  td{border:1px solid #bbdefb;padding:4px 8px;vertical-align:top}
  .done{color:#1b5e20}.undone{color:#9e9e9e}
  .footer{margin-top:30px;font-size:8.5pt;color:#9e9e9e;border-top:1px solid #eee;padding-top:8px}
</style></head>
<body>
<h1>재난 대응 보고서</h1>
<table>
  <tr><th style="width:15%">발령 시각</th><td style="width:35%">${fmtDateFull(inc.declared_at)}</td><th style="width:15%">발령자</th><td>${getN(inc.declared_by)}</td></tr>
  <tr><th>재난 유형</th><td>${inc.disaster}</td><th>구분</th><td>${inc.mode}</td></tr>
  <tr><th>발생 위치</th><td colspan="3">${inc.location}</td></tr>
</table>
<h2>📊 임무 수행 요약</h2>
<p>전체 임무 완수율: <strong>${pct}%</strong> &nbsp;(${done.length} / ${checkable.length}건 완료)</p>
<h2>👥 출동 현황 (${logDetail.responders.length}명)</h2>
<table>
  <tr><th>이름</th><th>소속</th><th>상태</th></tr>
  ${sortedResp.map(r=>`<tr><td>${r.name}</td><td>${r.team??''}</td><td style="color:${stColor(r.status)};font-weight:bold">${r.status}</td></tr>`).join('')}
</table>
<h2>✅ 임무 수행 내역</h2>
${Object.entries(roleGroups).map(([role,tasks])=>{
  const dc=tasks.filter(t=>t.done).length;
  return `<h3>${role} (${dc}/${tasks.length})</h3>
<table>
  <tr><th style="width:5%">완료</th><th>임무 내용</th><th style="width:14%">완료자</th><th style="width:14%">완료 시각</th></tr>
  ${[...tasks].sort((a,b)=>a.task_idx-b.task_idx).map(t=>`
  <tr><td style="text-align:center">${t.done?'✅':'⬜'}</td>
      <td class="${t.done?'done':'undone'}">${t.label}</td>
      <td>${t.done&&t.done_by?getN(t.done_by):''}</td>
      <td>${t.done&&t.updated_at?fmtDate(t.updated_at):''}</td></tr>`).join('')}
</table>`;}).join('')}
<div class="footer">이 보고서는 Twin-alarm 재난대응 시스템에서 자동 생성되었습니다. 생성 시각: ${new Date().toLocaleString('ko-KR')}</div>
</body></html>`;

    const blob = new Blob(['﻿' + html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `재난보고서_${inc.disaster}_${fmtDateFull(inc.declared_at).replace(/\//g,'-').replace(' ','-').replace(':','')}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  // 활동 로그: 발령 → 상태변경 → 임무완료 순으로 타임라인 구성
  const activityLog = useMemo(() => {
    if (!activeIncident) return [];
    type LogEntry = { time: number; icon: string; text: string; sub: string; color: string };
    const entries: LogEntry[] = [];

    entries.push({
      time: activeIncident.declared_at,
      icon: activeIncident.mode.startsWith('훈련') ? '🎓' : '🚨',
      text: `${activeIncident.disaster} ${activeIncident.mode} 발령`,
      sub: `위치: ${activeIncident.location}`,
      color: activeIncident.mode.startsWith('훈련') ? '#f59e0b' : '#ef4444',
    });

    validResponders
      .filter(r => r.status !== '미응답' && r.updated_at)
      .forEach(r => {
        const si: Record<string, { icon: string; color: string }> = {
          '출동중': { icon: '🚗', color: '#f97316' },
          '현장':   { icon: '📍', color: '#38bdf8' },
          '복귀':   { icon: '🏁', color: '#4ade80' },
        };
        const s = si[r.status] ?? { icon: '●', color: '#64748b' };
        entries.push({ time: r.updated_at, icon: s.icon, text: `${r.name} — ${r.status}`, sub: r.team, color: s.color });
      });

    tasks
      .filter(t => t.done && t.updated_at != null && !t.label.startsWith('◇') && !t.label.startsWith('◆'))
      .forEach(t => {
        entries.push({
          time: t.updated_at!,
          icon: '✅',
          text: t.label.replace(/^[◇◆┖└]\s*/, ''),
          sub: `[${t.role}]${t.done_by ? ` · ${t.done_by}` : ''}`,
          color: '#10b981',
        });
      });

    return entries.sort((a, b) => a.time - b.time);
  }, [activeIncident, validResponders, tasks]);

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
        <>
          {/* 헤더 카드 (제목 + 화자변경) */}
          <div className="card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldAlert color="var(--color-fire)" size={22} style={{ flexShrink: 0 }} />
              <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px', margin: 0, flex: 1 }}>
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
          </div>

          <form onSubmit={handleDeclare} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 재난 유형 + 발령구분 + 화재서브모드 */}
            <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
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

              <div>
                <label>발령 구분</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(['훈련', '실제'] as const).map(mode => {
                    const isSel = selectedMode === mode;
                    const color = mode === '훈련' ? '#a78bfa' : '#ef4444';
                    const modeLabel = mode === '훈련' ? '🎓 훈련상황' : '⚠️ 실제상황';
                    const subOptions = isFireDisaster
                      ? mode === '훈련'
                        ? [{ key: 'initial' as const, icon: '🔔', label: '감지기동작' }, { key: 'full' as const, icon: '🎯', label: '전체훈련' }]
                        : [{ key: 'initial' as const, icon: '🔔', label: '감지기동작' }, { key: 'full' as const, icon: '🔥', label: '화재상황' }]
                      : [];
                    const subLabel = isSel && isFireDisaster
                      ? (fireSubMode === 'initial' ? '감지기동작' : mode === '훈련' ? '전체훈련' : '화재상황')
                      : '';
                    return (
                      <div key={mode} style={{
                        border: `1px solid ${isSel ? color + '55' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: '10px', overflow: 'hidden',
                        background: isSel ? color + '08' : 'transparent',
                        transition: 'all 0.2s',
                      }}>
                        <div
                          onClick={() => setSelectedMode(mode)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '11px 14px', cursor: 'pointer',
                            borderLeft: `3px solid ${isSel ? color : 'transparent'}`,
                          }}
                        >
                          <span style={{ fontSize: '14px', fontWeight: 700, color: isSel ? color : '#64748b', flex: 1 }}>
                            {modeLabel}
                          </span>
                          {subLabel && (
                            <span style={{ fontSize: '11px', color: color + 'bb', fontWeight: 600 }}>{subLabel}</span>
                          )}
                          {isFireDisaster && (
                            <span style={{ fontSize: '10px', color: '#475569' }}>{isSel ? '▲' : '▶'}</span>
                          )}
                        </div>
                        {isSel && isFireDisaster && (
                          <div style={{
                            display: 'flex', gap: '6px', padding: '8px 12px 10px',
                            borderTop: `1px solid ${color}22`,
                            background: 'rgba(0,0,0,0.18)',
                          }}>
                            {subOptions.map(opt => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={e => { e.stopPropagation(); setFireSubMode(opt.key); }}
                                style={{
                                  flex: 1, padding: '8px 0', borderRadius: '8px', cursor: 'pointer',
                                  fontSize: '12px', fontWeight: 700,
                                  background: fireSubMode === opt.key ? color + '22' : 'rgba(255,255,255,0.04)',
                                  border: `1px solid ${fireSubMode === opt.key ? color + '66' : 'rgba(255,255,255,0.07)'}`,
                                  color: fireSubMode === opt.key ? color : '#64748b',
                                  transition: 'all 0.15s',
                                }}
                              >
                                {opt.icon} {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

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
                    {/* ── 메뉴바 ── */}
                    <div style={{ display: 'flex', gap: '4px', padding: '7px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
                      {(() => {
                        const allIds = employees.map(e => e.emp_no);
                        const allSel = allIds.length > 0 && allIds.every(id => selectedEmps.has(id));
                        const partSel = !allSel && allIds.some(id => selectedEmps.has(id));
                        return (
                          <button type="button" onClick={() => setSelectedEmps(allSel ? new Set() : new Set(allIds))} style={{
                            padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 800, flexShrink: 0,
                            border: `1px solid ${allSel ? '#818cf8' : partSel ? '#818cf866' : '#818cf844'}`,
                            background: allSel ? '#818cf822' : partSel ? '#818cf80d' : 'transparent',
                            color: allSel ? '#818cf8' : partSel ? '#818cf8aa' : '#64748b',
                          }}>전체</button>
                        );
                      })()}
                      {INCIDENT_GROUPS.map(({ key, label, color }) => {
                        const grpIds = employees.filter(e => getIncidentGroup(e, selectedDisasterKey) === key).map(e => e.emp_no);
                        if (grpIds.length === 0) return null;
                        const selCount = grpIds.filter(id => selectedEmps.has(id)).length;
                        const allSel = selCount === grpIds.length;
                        const partSel = selCount > 0 && !allSel;
                        return (
                          <button key={key} type="button" onClick={() => setSelectedEmps(prev => {
                            const next = new Set(prev);
                            if (allSel) grpIds.forEach(id => next.delete(id));
                            else grpIds.forEach(id => next.add(id));
                            return next;
                          })} style={{
                            padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, flexShrink: 0,
                            border: `1px solid ${allSel ? color : partSel ? color + '66' : color + '44'}`,
                            background: allSel ? color + '22' : partSel ? color + '0d' : 'transparent',
                            color: allSel ? color : partSel ? color + 'bb' : '#64748b',
                          }}>
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* ── 아코디언 목록 (그룹 → 팀 서브섹션) ── */}
                    {INCIDENT_GROUPS.map(({ key: grpKey, color }) => {
                      const grpEmps = employees.filter(e => getIncidentGroup(e, selectedDisasterKey) === grpKey);
                      if (grpEmps.length === 0) return null;
                      const selCount = grpEmps.filter(e => selectedEmps.has(e.emp_no)).length;
                      const allSel = selCount === grpEmps.length;
                      const isOpen = openAccordions.has(grpKey);

                      const tmap: Record<string, EmployeeDB[]> = {};
                      for (const e of grpEmps) {
                        const t = normalizeParticipantTeam(e.team, e.role);
                        (tmap[t] ??= []).push(e);
                      }
                      const teams: [string, EmployeeDB[]][] = [
                        ...TEAM_ORDER.filter(t => tmap[t]).map(t => [t, tmap[t]] as [string, EmployeeDB[]]),
                        ...Object.entries(tmap).filter(([t]) => !TEAM_ORDER.includes(t)),
                      ];

                      const toggleGrpSel = () => setSelectedEmps(prev => {
                        const next = new Set(prev);
                        if (allSel) grpEmps.forEach(e => next.delete(e.emp_no));
                        else grpEmps.forEach(e => next.add(e.emp_no));
                        return next;
                      });

                      const mkEmpRow = (emp: EmployeeDB, c: string) => {
                        const checked = selectedEmps.has(emp.emp_no);
                        return (
                          <div key={emp.emp_no} onClick={() => setSelectedEmps(prev => {
                            const next = new Set(prev); next.has(emp.emp_no) ? next.delete(emp.emp_no) : next.add(emp.emp_no); return next;
                          })} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 4px', cursor: 'pointer' }}>
                            <div style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, border: `2px solid ${checked ? c : 'rgba(255,255,255,0.15)'}`, background: checked ? c + '33' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {checked && <span style={{ color: c, fontSize: '9px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: '12px', flex: 1, color: checked ? '#e2e8f0' : '#94a3b8' }}>{emp.name}</span>
                            <span style={{ fontSize: '10px', color: '#475569' }}>{emp.role}</span>
                          </div>
                        );
                      };

                      return (
                        <div key={grpKey} style={{ borderBottom: `1px solid ${color}33` }}>
                          <div onClick={() => setOpenAccordions(prev => { const next = new Set(prev); next.has(grpKey) ? next.delete(grpKey) : next.add(grpKey); return next; })} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', cursor: 'pointer', borderLeft: `3px solid ${selCount > 0 ? color : 'rgba(255,255,255,0.08)'}`, background: selCount > 0 ? color + '08' : 'transparent' }}>
                            <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: selCount > 0 ? color : '#94a3b8' }}>{grpKey}</span>
                            <span style={{ fontSize: '11px', color: selCount > 0 ? color : '#475569', fontWeight: 600 }}>{selCount}/{grpEmps.length}명</span>
                            <button type="button" onClick={e => { e.stopPropagation(); toggleGrpSel(); }} style={{ padding: '3px 9px', borderRadius: '5px', fontSize: '10px', fontWeight: 700, border: `1px solid ${allSel ? color : color + '55'}`, background: allSel ? color + '22' : 'transparent', color: allSel ? color : color + 'aa', cursor: 'pointer', flexShrink: 0, marginLeft: '6px' }}>{allSel ? '해제' : '선택'}</button>
                            <span style={{ fontSize: '11px', color: '#475569', marginLeft: '4px' }}>{isOpen ? '▲' : '▼'}</span>
                          </div>
                          {isOpen && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 12px 8px' }}>
                              {grpKey === '교대' ? (
                                (['A', 'B', 'C', 'D'] as const).map(cho => {
                                  const choEmps = grpEmps.filter(e => e.role.includes(cho + '조'));
                                  if (choEmps.length === 0) return null;
                                  const cc = ({ A: '#a5b4fc', B: '#86efac', C: '#fdba74', D: '#f9a8d4' } as Record<string, string>)[cho];
                                  const choSel = choEmps.filter(e => selectedEmps.has(e.emp_no)).length;
                                  const allChoSel = choSel === choEmps.length;
                                  return (
                                    <div key={cho}>
                                      <div onClick={() => setSelectedEmps(prev => {
                                        const next = new Set(prev);
                                        if (allChoSel) choEmps.forEach(e => next.delete(e.emp_no));
                                        else choEmps.forEach(e => next.add(e.emp_no));
                                        return next;
                                      })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 4px 3px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: '2px' }}>
                                        <span style={{ fontSize: '11px', color: cc, fontWeight: 700 }}>{cho}조</span>
                                        <span style={{ fontSize: '10px', color: '#475569' }}>{choSel}/{choEmps.length}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '10px', color: allChoSel ? cc : '#475569' }}>{allChoSel ? '전체해제' : '전체선택'}</span>
                                      </div>
                                      {choEmps.map(emp => mkEmpRow(emp, cc))}
                                    </div>
                                  );
                                })
                              ) : (
                                teams.map(([team, teamEmps]) => {
                                  const tSel = teamEmps.filter(e => selectedEmps.has(e.emp_no)).length;
                                  const allTSel = tSel === teamEmps.length;
                                  return (
                                    <div key={team} style={{ marginBottom: '3px' }}>
                                      <div onClick={() => setSelectedEmps(prev => {
                                        const next = new Set(prev);
                                        if (allTSel) teamEmps.forEach(e => next.delete(e.emp_no));
                                        else teamEmps.forEach(e => next.add(e.emp_no));
                                        return next;
                                      })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 4px 2px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: '2px' }}>
                                        <span style={{ fontSize: '11px', color: tSel > 0 ? color : '#64748b', fontWeight: 700, flex: 1 }}>{team}</span>
                                        <span style={{ fontSize: '10px', color: '#475569' }}>{tSel}/{teamEmps.length}</span>
                                      </div>
                                      {teamEmps.map(emp => mkEmpRow(emp, color))}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

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

          {/* 이전 재난 기록 */}
          <button type="button" onClick={loadLog} disabled={logLoading}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '10px 14px', borderRadius: '10px', cursor: logLoading ? 'default' : 'pointer',
              border: '1px solid rgba(148,163,184,0.2)',
              background: 'rgba(148,163,184,0.04)',
              color: '#64748b', fontSize: '13px', fontWeight: 700,
            }}>
            <History size={15} />
            {logLoading ? '로딩 중...' : '이전 재난 기록 보기'}
          </button>

          {showLog && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                  <History size={14} /> 종료 재난 기록 (최근 30건)
                </span>
                <button type="button" onClick={() => setShowLog(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px', display: 'flex' }}>
                  <X size={16} />
                </button>
              </div>
              {logIncidents.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#475569', fontSize: '13px' }}>종료된 재난 기록이 없습니다.</div>
              ) : (
                logIncidents.map(inc => {
                  const isExpanded = expandedLogId === inc.id;
                  return (
                    <div key={inc.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <div onClick={() => loadLogDetail(inc.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 14px', cursor: 'pointer', background: isExpanded ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>{inc.disaster} — {inc.location}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{inc.mode} · {fmtDate(inc.declared_at)}</div>
                        </div>
                        <ChevronDown size={14} color="#475569" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '10px 14px 14px', background: 'rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          {logDetailLoading ? (
                            <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', padding: '12px' }}>로딩 중...</div>
                          ) : logDetail ? (() => {
                            const getEmpName = (empNo: string | null | undefined) =>
                              employees.find(e => e.emp_no === empNo)?.name ?? (empNo || '—');

                            const checkable = logDetail.tasks.filter(t => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
                            const doneTasks = checkable.filter(t => t.done);
                            const pct = checkable.length > 0 ? Math.round(doneTasks.length / checkable.length * 100) : 0;

                            const roleGroups: Record<string, typeof logDetail.tasks> = {};
                            for (const t of checkable) { (roleGroups[t.role] ??= []).push(t); }

                            const secTitle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '7px' };

                            return (
                              <>
                                {/* ① 발령 정보 */}
                                <div>
                                  <div style={secTitle}>📋 발령 정보</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                                    {([
                                      ['발령 시각', fmtDateFull(inc.declared_at)],
                                      ['발령자', getEmpName(inc.declared_by)],
                                      ['구분', inc.mode],
                                      ['위치', inc.location],
                                    ] as [string, string][]).map(([lbl, val]) => (
                                      <div key={lbl} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '6px', padding: '5px 8px' }}>
                                        <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, marginBottom: '2px' }}>{lbl}</div>
                                        <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 600, wordBreak: 'break-all' }}>{val}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                {/* 다운로드 버튼 */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <button type="button" onClick={() => downloadReport(inc)} style={{
                                    display: 'flex', alignItems: 'center', gap: '5px',
                                    padding: '5px 11px', borderRadius: '6px', cursor: 'pointer',
                                    fontSize: '11px', fontWeight: 700,
                                    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)',
                                    color: '#a5b4fc',
                                  }}>📄 보고서 다운로드</button>
                                </div>

                                {/* ② 출동 현황 아코디언 */}
                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '7px', overflow: 'hidden' }}>
                                  <div onClick={() => toggleSub(inc.id, 'responders')} style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', cursor: 'pointer',
                                    background: 'rgba(255,255,255,0.04)',
                                    borderBottom: isSubOpen(inc.id, 'responders') ? '1px solid rgba(255,255,255,0.07)' : 'none',
                                  }}>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', flex: 1 }}>
                                      👥 출동 현황 ({logDetail.responders.length}명)
                                    </span>
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' as const }}>
                                      {(['현장', '복귀', '출동중', '미응답'] as const).map(st => {
                                        const cnt = logDetail!.responders.filter(r => r.status === st).length;
                                        if (cnt === 0) return null;
                                        const c = st==='출동중'?'#f97316':st==='현장'?'#38bdf8':st==='복귀'?'#4ade80':'#64748b';
                                        return <span key={st} style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: c+'22', color: c, fontWeight: 700 }}>{st} {cnt}</span>;
                                      })}
                                    </div>
                                    <ChevronDown size={13} color="#475569" style={{ transform: isSubOpen(inc.id, 'responders') ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                                  </div>
                                  {isSubOpen(inc.id, 'responders') && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px 8px' }}>
                                      {[...logDetail.responders]
                                        .sort((a, b) => {
                                          const ord = ['현장', '복귀', '출동중', '미응답'];
                                          return ord.indexOf(a.status) - ord.indexOf(b.status);
                                        })
                                        .map(r => {
                                          const c = r.status==='출동중'?'#f97316':r.status==='현장'?'#38bdf8':r.status==='복귀'?'#4ade80':'#64748b';
                                          return (
                                            <div key={r.emp_no} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', borderRadius: '5px', background: 'rgba(255,255,255,0.03)' }}>
                                              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c, flexShrink: 0 }} />
                                              <span style={{ fontSize: '12px', color: '#e2e8f0', flex: 1 }}>{r.name}</span>
                                              <span style={{ fontSize: '10px', color: '#475569' }}>{r.team}</span>
                                              <span style={{ fontSize: '11px', color: c, fontWeight: 700, marginLeft: '4px' }}>{r.status}</span>
                                            </div>
                                          );
                                        })
                                      }
                                    </div>
                                  )}
                                </div>

                                {/* ③ 임무 수행 내역 아코디언 */}
                                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '7px', overflow: 'hidden' }}>
                                  <div onClick={() => toggleSub(inc.id, 'tasks')} style={{
                                    display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', cursor: 'pointer',
                                    background: 'rgba(255,255,255,0.04)',
                                    borderBottom: isSubOpen(inc.id, 'tasks') ? '1px solid rgba(255,255,255,0.07)' : 'none',
                                  }}>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', flex: 1 }}>
                                      ✅ 임무 수행 내역
                                    </span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <div style={{ width: '60px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.06)' }}>
                                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px', background: '#10b981' }} />
                                      </div>
                                      <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700, whiteSpace: 'nowrap' as const }}>{pct}% ({doneTasks.length}/{checkable.length})</span>
                                    </div>
                                    <ChevronDown size={13} color="#475569" style={{ transform: isSubOpen(inc.id, 'tasks') ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                                  </div>
                                  {isSubOpen(inc.id, 'tasks') && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '8px' }}>
                                      {Object.entries(roleGroups).map(([role, roleTasks]) => {
                                        const doneInRole = roleTasks.filter(t => t.done).length;
                                        return (
                                          <div key={role}>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '4px' }}>
                                              {role} ({doneInRole}/{roleTasks.length})
                                            </div>
                                            {[...roleTasks].sort((a, b) => a.task_idx - b.task_idx).map(t => (
                                              <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '3px 2px', opacity: t.done ? 1 : 0.4 }}>
                                                <span style={{ fontSize: '11px', marginTop: '1px', flexShrink: 0 }}>{t.done ? '✅' : '⬜'}</span>
                                                <span style={{ fontSize: '12px', color: t.done ? '#e2e8f0' : '#64748b', flex: 1 }}>{t.label}</span>
                                                {t.done && (
                                                  <span style={{ fontSize: '10px', color: '#475569', flexShrink: 0, textAlign: 'right' as const }}>
                                                    {t.done_by ? getEmpName(t.done_by) : ''}
                                                    {t.updated_at ? ` ${fmtDate(t.updated_at)}` : ''}
                                                  </span>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </>
                            );
                          })() : null}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
        )
      ) : (
        // ── 발령 중 모니터링 ────────────────────────
        <>
          {/* 임무 수행률 */}
          <div className="card" style={{ padding: '12px 16px' }}>
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

          {/* 대원 현황 + 활동 기록 — 탭 아코디언 (flex: 1 로 남은 높이 채움) */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* 헤더 (클릭 = 접기/펼치기) */}
            <div
              className="accordion-header"
              onClick={() => setShowResponders(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', flexShrink: 0, borderBottom: showResponders ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
            >
              <Users size={18} color="var(--color-water)" />
              <span style={{ flex: 1, fontSize: '14px', fontWeight: 700 }}>
                대원 출동 현황
                {activeIsInitial && <span style={{ fontSize: '11px', color: '#fbbf24', marginLeft: '6px' }}>초기출동조</span>}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-power)', fontWeight: 700 }}>출동 {respondersByStatus('출동중').length}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-water)', fontWeight: 700 }}>현장 {respondersByStatus('현장').length}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>총 {validResponders.length}명</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{showResponders ? '▲' : '▼'}</span>
              </div>
            </div>

            {showResponders && (
              <>
                {/* 탭 버튼 */}
                <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {([
                    { key: 'roster' as const, label: '👥 출동', color: '#38bdf8' },
                    { key: 'log'    as const, label: '📋 활동', color: '#a855f7' },
                    { key: 'ai'     as const, label: '🤖 AI보고서', color: '#10b981' },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        if (tab.key === 'ai' && activeMonitorTab !== 'ai') {
                          generateAIReport();
                        } else {
                          setActiveMonitorTab(tab.key);
                        }
                      }}
                      style={{
                        flex: 1, padding: '8px 0', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                        background: activeMonitorTab === tab.key ? tab.color + '18' : 'transparent',
                        border: 'none',
                        borderBottom: `2px solid ${activeMonitorTab === tab.key ? tab.color : 'transparent'}`,
                        color: activeMonitorTab === tab.key ? tab.color : '#64748b',
                        transition: 'all 0.15s',
                      }}
                    >
                      {tab.key === 'ai' && aiLoading ? '⏳ 생성중...' : tab.label}
                    </button>
                  ))}
                </div>

                {/* 출동 현황 탭 */}
                {activeMonitorTab === 'roster' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
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

                {/* 활동 기록 탭 */}
                {activeMonitorTab === 'log' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px' }}>
                    {activityLog.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '13px' }}>활동 기록이 없습니다.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {activityLog.map((entry, i) => (
                          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px 0', borderBottom: i < activityLog.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                            <div style={{ fontSize: '11px', color: '#475569', fontWeight: 700, flexShrink: 0, width: '38px', paddingTop: '2px' }}>
                              {fmtTime(entry.time)}
                            </div>
                            <div style={{ fontSize: '14px', flexShrink: 0, width: '20px', lineHeight: 1.4 }}>{entry.icon}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '12px', color: entry.color, fontWeight: 700, lineHeight: 1.4 }}>{entry.text}</div>
                              {entry.sub && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>{entry.sub}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* AI 보고서 탭 */}
                {activeMonitorTab === 'ai' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                    {aiLoading ? (
                      <div style={{ textAlign: 'center', padding: '30px 20px', color: '#64748b' }}>
                        <div style={{ fontSize: '28px', marginBottom: '10px' }}>🤖</div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#10b981' }}>AI가 상황을 분석 중입니다...</div>
                        <div style={{ fontSize: '11px', marginTop: '6px', color: '#475569' }}>현재 데이터를 종합하여 보고서를 작성합니다</div>
                      </div>
                    ) : aiReport ? (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
                          <button
                            type="button"
                            onClick={generateAIReport}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '5px',
                              padding: '5px 11px', borderRadius: '6px', cursor: 'pointer',
                              fontSize: '11px', fontWeight: 700,
                              background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
                              color: '#34d399',
                            }}
                          >
                            🔄 재생성
                          </button>
                        </div>
                        <div style={{
                          fontSize: '12px', lineHeight: 1.8, color: '#e2e8f0',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {aiReport.split('\n').map((line, i) => {
                            if (line.startsWith('## ')) return <div key={i} style={{ fontSize: '14px', fontWeight: 800, color: '#f8fafc', margin: '6px 0 8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>{line.replace('## ', '')}</div>;
                            if (line.startsWith('**') && line.endsWith('**')) return <div key={i} style={{ fontSize: '12px', fontWeight: 700, color: '#10b981', margin: '10px 0 4px' }}>{line.replace(/\*\*/g, '')}</div>;
                            if (line.trim() === '') return <div key={i} style={{ height: '4px' }} />;
                            return <div key={i} style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.7 }}>{line}</div>;
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '30px 20px', color: '#64748b' }}>
                        <div style={{ fontSize: '28px', marginBottom: '10px' }}>🤖</div>
                        <div style={{ fontSize: '13px' }}>탭을 다시 클릭하면 보고서를 생성합니다</div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 지휘관 전용 액션 버튼 */}
          {isCommander && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>
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
                          {/* ── 메뉴바 (1차와 동일 구조, escalateEmps 사용) ── */}
                          <div style={{ display: 'flex', gap: '4px', padding: '7px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
                            {(() => {
                              const allIds = employees.map(e => e.emp_no);
                              const allSel = allIds.length > 0 && allIds.every(id => escalateEmps.has(id));
                              const partSel = !allSel && allIds.some(id => escalateEmps.has(id));
                              return (
                                <button type="button" onClick={() => setEscalateEmps(allSel ? new Set() : new Set(allIds))} style={{
                                  padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 800, flexShrink: 0,
                                  border: `1px solid ${allSel ? '#818cf8' : partSel ? '#818cf866' : '#818cf844'}`,
                                  background: allSel ? '#818cf822' : partSel ? '#818cf80d' : 'transparent',
                                  color: allSel ? '#818cf8' : partSel ? '#818cf8aa' : '#64748b',
                                }}>전체</button>
                              );
                            })()}
                            {INCIDENT_GROUPS.map(({ key, label, color }) => {
                              const grpIds = employees.filter(e => getIncidentGroup(e, activeIncident!.disaster) === key).map(e => e.emp_no);
                              if (grpIds.length === 0) return null;
                              const selCount = grpIds.filter(id => escalateEmps.has(id)).length;
                              const allSel = selCount === grpIds.length;
                              const partSel = selCount > 0 && !allSel;
                              return (
                                <button key={key} type="button" onClick={() => setEscalateEmps(prev => {
                                  const next = new Set(prev);
                                  if (allSel) grpIds.forEach(id => next.delete(id));
                                  else grpIds.forEach(id => next.add(id));
                                  return next;
                                })} style={{
                                  padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, flexShrink: 0,
                                  border: `1px solid ${allSel ? color : partSel ? color + '66' : color + '44'}`,
                                  background: allSel ? color + '22' : partSel ? color + '0d' : 'transparent',
                                  color: allSel ? color : partSel ? color + 'bb' : '#64748b',
                                }}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>

                          {/* ── 아코디언 목록 (1차에서 이어받은 선택 표시) ── */}
                          {INCIDENT_GROUPS.map(({ key: grpKey, color }) => {
                            const grpEmps = employees.filter(e => getIncidentGroup(e, activeIncident!.disaster) === grpKey);
                            if (grpEmps.length === 0) return null;
                            const selCount = grpEmps.filter(e => escalateEmps.has(e.emp_no)).length;
                            const allSel = selCount === grpEmps.length;
                            const isOpen = openEscalateAccordions.has(grpKey);

                            const tmap: Record<string, EmployeeDB[]> = {};
                            for (const e of grpEmps) {
                              const t = normalizeParticipantTeam(e.team, e.role);
                              (tmap[t] ??= []).push(e);
                            }
                            const teams: [string, EmployeeDB[]][] = [
                              ...TEAM_ORDER.filter(t => tmap[t]).map(t => [t, tmap[t]] as [string, EmployeeDB[]]),
                              ...Object.entries(tmap).filter(([t]) => !TEAM_ORDER.includes(t)),
                            ];

                            const toggleGrpSel = () => setEscalateEmps(prev => {
                              const next = new Set(prev);
                              if (allSel) grpEmps.forEach(e => next.delete(e.emp_no));
                              else grpEmps.forEach(e => next.add(e.emp_no));
                              return next;
                            });

                            const mkEmpRow = (emp: EmployeeDB, c: string) => {
                              const checked = escalateEmps.has(emp.emp_no);
                              return (
                                <div key={emp.emp_no} onClick={() => setEscalateEmps(prev => {
                                  const next = new Set(prev); next.has(emp.emp_no) ? next.delete(emp.emp_no) : next.add(emp.emp_no); return next;
                                })} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 4px', cursor: 'pointer' }}>
                                  <div style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, border: `2px solid ${checked ? c : 'rgba(255,255,255,0.15)'}`, background: checked ? c + '33' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {checked && <span style={{ color: c, fontSize: '9px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                                  </div>
                                  <span style={{ fontSize: '12px', flex: 1, color: checked ? '#e2e8f0' : '#94a3b8' }}>{emp.name}</span>
                                  <span style={{ fontSize: '10px', color: '#475569' }}>{emp.role}</span>
                                </div>
                              );
                            };

                            return (
                              <div key={grpKey} style={{ borderBottom: `1px solid ${color}33` }}>
                                <div onClick={() => setOpenEscalateAccordions(prev => { const next = new Set(prev); next.has(grpKey) ? next.delete(grpKey) : next.add(grpKey); return next; })} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', cursor: 'pointer', borderLeft: `3px solid ${selCount > 0 ? color : 'rgba(255,255,255,0.08)'}`, background: selCount > 0 ? color + '08' : 'transparent' }}>
                                  <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: selCount > 0 ? color : '#94a3b8' }}>{grpKey}</span>
                                  <span style={{ fontSize: '11px', color: selCount > 0 ? color : '#475569', fontWeight: 600 }}>{selCount}/{grpEmps.length}명</span>
                                  <button type="button" onClick={e => { e.stopPropagation(); toggleGrpSel(); }} style={{ padding: '3px 9px', borderRadius: '5px', fontSize: '10px', fontWeight: 700, border: `1px solid ${allSel ? color : color + '55'}`, background: allSel ? color + '22' : 'transparent', color: allSel ? color : color + 'aa', cursor: 'pointer', flexShrink: 0, marginLeft: '6px' }}>{allSel ? '해제' : '선택'}</button>
                                  <span style={{ fontSize: '11px', color: '#475569', marginLeft: '4px' }}>{isOpen ? '▲' : '▼'}</span>
                                </div>
                                {isOpen && (
                                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 12px 8px' }}>
                                    {grpKey === '교대' ? (
                                      (['A', 'B', 'C', 'D'] as const).map(cho => {
                                        const choEmps = grpEmps.filter(e => e.role.includes(cho + '조'));
                                        if (choEmps.length === 0) return null;
                                        const cc = ({ A: '#a5b4fc', B: '#86efac', C: '#fdba74', D: '#f9a8d4' } as Record<string, string>)[cho];
                                        const choSel = choEmps.filter(e => escalateEmps.has(e.emp_no)).length;
                                        const allChoSel = choSel === choEmps.length;
                                        return (
                                          <div key={cho}>
                                            <div onClick={() => setEscalateEmps(prev => {
                                              const next = new Set(prev);
                                              if (allChoSel) choEmps.forEach(e => next.delete(e.emp_no));
                                              else choEmps.forEach(e => next.add(e.emp_no));
                                              return next;
                                            })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 4px 3px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: '2px' }}>
                                              <span style={{ fontSize: '11px', color: cc, fontWeight: 700 }}>{cho}조</span>
                                              <span style={{ fontSize: '10px', color: '#475569' }}>{choSel}/{choEmps.length}</span>
                                              <span style={{ marginLeft: 'auto', fontSize: '10px', color: allChoSel ? cc : '#475569' }}>{allChoSel ? '전체해제' : '전체선택'}</span>
                                            </div>
                                            {choEmps.map(emp => mkEmpRow(emp, cc))}
                                          </div>
                                        );
                                      })
                                    ) : (
                                      teams.map(([team, teamEmps]) => {
                                        const tSel = teamEmps.filter(e => escalateEmps.has(e.emp_no)).length;
                                        const allTSel = tSel === teamEmps.length;
                                        return (
                                          <div key={team} style={{ marginBottom: '3px' }}>
                                            <div onClick={() => setEscalateEmps(prev => {
                                              const next = new Set(prev);
                                              if (allTSel) teamEmps.forEach(e => next.delete(e.emp_no));
                                              else teamEmps.forEach(e => next.add(e.emp_no));
                                              return next;
                                            })} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 4px 2px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: '2px' }}>
                                              <span style={{ fontSize: '11px', color: tSel > 0 ? color : '#64748b', fontWeight: 700, flex: 1 }}>{team}</span>
                                              <span style={{ fontSize: '10px', color: '#475569' }}>{tSel}/{teamEmps.length}</span>
                                            </div>
                                            {teamEmps.map(emp => mkEmpRow(emp, color))}
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          <div style={{ padding: '5px 12px 7px', textAlign: 'right', fontSize: '11px', color: '#64748b' }}>
                            <strong style={{ color: '#e2e8f0' }}>{escalateEmps.size}명</strong> 선택 (선택 대원에게만 알람 발송)
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button onClick={handleFireEscalate} className="btn" disabled={loading}
                    style={{
                      background: 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(220,38,38,0.20))',
                      border: '1px solid rgba(239,68,68,0.35)',
                      color: '#fca5a5',
                    }}
                  >
                    {!activeIsTraining ? '🔥 화재상황으로 승격 (나머지 대원 소집)' : '🎯 2차 출동 발령'}
                  </button>
                </>
              )}

              <button onClick={handleClose} className="btn" disabled={loading}
                style={{
                  background: 'rgba(59,130,246,0.06)',
                  border: '1px solid rgba(59,130,246,0.45)',
                  color: '#60a5fa',
                }}
              >
                <Square size={16} fill="#60a5fa" />
                상황 종료 및 리셋
              </button>
            </div>
          )}
        </>
      )}

    </div>
  );
};
