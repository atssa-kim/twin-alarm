import React, { useState, useMemo, useEffect } from 'react';
import { type Incident, type Responder, type MemberTask, type EmployeeDB, db, supabase } from '../services/supabase';
import { DISASTERS, FIRE_INITIAL_BADGES } from '../data/disasters';
import { stopAllAlerts } from '../utils/audio';
import { Play, Square, Users, UserCheck, BarChart2, Monitor } from 'lucide-react';

// 상황 확정(variant) 칩 표시용 라벨 — 새 variant를 추가할 때 여기만 채우면 됨 (미등록 값은 그대로 표시)
export const VARIANT_LABELS: Record<string, string> = {
  'K급주방': '🍳 K급주방',
  '가스구역': '💨 가스구역',
  'UPS실': '🔋 UPS실',
  '지하주차장': '🚗 지하주차장',
};

// 재난 발생 위치 텍스트에 이 키워드가 포함되면 발령 즉시 해당 상황(variant)을 자동 확정 —
// 지휘관이 발령 후 별도로 "상황 확정" 버튼을 누르지 않아도 출동조·소화조·소방안전관리자의
// 임무가 그 상황에 맞게 바로 표시되도록 함(2026-08-26). 위에 없는 키워드가 먼저 매칭되면
// 그 variant를 쓰고, 매칭이 없으면 기존처럼 미확정(null) 상태로 발령됨 — 나중에 수동 확정 가능.
const LOCATION_VARIANT_KEYWORDS: [string, string][] = [
  ['지하주차장', '지하주차장'],
  ['UPS', 'UPS실'],
  ['주방', 'K급주방'],
  ['가스방호구역', '가스구역'],
];
function detectVariantFromLocation(location: string): string | null {
  const lower = location.toLowerCase();
  for (const [keyword, variant] of LOCATION_VARIANT_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) return variant;
  }
  return null;
}

// 전광판 표시용 상태 라벨 — 출동중 체크 여부와 무관하게 임무를 하나라도 체크하면 자동으로 '현장'
// 상태가 됨(2026-07-24). 화면에는 데이터값 그대로 "현장"으로 표시.
const responderStatusLabel = (status: string) => status;

// 참여인원 모달: 파트장 → 파트로, 교대 직원 → 상황실로 통합
const normalizeParticipantTeam = (team: string, role: string) =>
  isShiftEmployee(role) ? '상황실'
  : team.endsWith('파트장') ? team.replace('파트장', '파트') : team;

// 교대 여부
const isShiftEmployee = (role: string) => role.includes('교대');


const INCIDENT_GROUPS = [
  { key: '지휘연락', label: '지휘연락', color: '#b45309' },
  { key: '현장대응', label: '현장대응', color: '#dc2626' },
  { key: '대피지원', label: '대피지원', color: '#2563eb' },
  { key: '교대',    label: '교대',    color: '#7c3aed' },
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
  '가스누출':  ['건축파트장', '건축사무', '건축현장', '건축파트', '보안1', '보안2', '보안3', '미화파트'],
  '승강기':   ['보안1', '보안2', '보안3', '미화파트'],
  '테러':     ['운영파트장', '운영파트', '건축파트장', '건축사무', '건축현장', '건축파트'],
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
}

const TEAM_ORDER = [
  '상황실', '센터장',
  '기계파트', '전기파트', '소방파트',
  '운영파트', '건축파트', '품질/안전파트',
  '보안1', '보안2', '보안3',
  '주차파트', '미화파트',
];

// 훈련 참여인원 선택기(1차 발령)와 2차 소집 대원 선택기가 거의 동일한 구조라 공통 컴포넌트로
// 추출함(2026-07-20) — 재난그룹 메뉴바 + 그룹→팀(또는 교대 A/B/C/D) 아코디언 + 하단 선택 인원수.
// 바깥 토글 버튼(라벨·아이콘)은 두 화면에서 문구가 달라 각 호출부에 그대로 남겨두고,
// 이 컴포넌트는 펼쳐졌을 때 보이는 내부 목록만 담당한다.
interface EmployeeGroupPickerProps {
  employees: EmployeeDB[];
  disasterKey: string;
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  openAccordions: Set<string>;
  setOpenAccordions: React.Dispatch<React.SetStateAction<Set<string>>>;
  wrapperBorderColor: string;
  footerSuffix?: string;
  showTotalPrefix?: boolean;
  // 훈련 중 TTS 즉시발신 대상 — 제공 시에만 각 행에 별도 체크박스로 렌더링 (참여 여부와 독립)
  ttsSelected?: Set<string>;
  setTtsSelected?: React.Dispatch<React.SetStateAction<Set<string>>>;
}

const EmployeeGroupPicker: React.FC<EmployeeGroupPickerProps> = ({
  employees, disasterKey, selected, setSelected, openAccordions, setOpenAccordions, wrapperBorderColor, footerSuffix, showTotalPrefix = true,
  ttsSelected, setTtsSelected,
}) => {
  // 참여 체크 시 TTS도 기본으로 같이 켜짐(개별 해제는 계속 가능) — 2026-07-26 결정.
  // "참여" 관련 토글은 전부 이 함수를 거치도록 통일해, ttsSelected가 제공된 화면(훈련
  // 참여인원 설정)에서는 항상 참여-TTS가 같이 움직이게 함.
  const applyParticipant = (ids: string[], add: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => (add ? next.add(id) : next.delete(id)));
      return next;
    });
    if (setTtsSelected) {
      setTtsSelected(prev => {
        const next = new Set(prev);
        ids.forEach(id => (add ? next.add(id) : next.delete(id)));
        return next;
      });
    }
  };

  return (
    <div style={{ marginTop: '6px', border: `1px solid ${wrapperBorderColor}`, borderRadius: '10px', overflow: 'hidden', background: 'rgba(11,37,69,0.03)' }}>
      {/* ── 메뉴바 ── */}
      <div style={{ display: 'flex', gap: '4px', padding: '7px 8px', borderBottom: '1px solid rgba(11,37,69,0.06)', overflowX: 'auto' }}>
        {(() => {
          const allIds = employees.map(e => e.emp_no);
          const allSel = allIds.length > 0 && allIds.every(id => selected.has(id));
          const partSel = !allSel && allIds.some(id => selected.has(id));
          return (
            <button type="button" onClick={() => applyParticipant(allIds, !allSel)} style={{
              padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 800, flexShrink: 0,
              border: `1px solid ${allSel ? '#4f46e5' : partSel ? '#4f46e566' : '#4f46e544'}`,
              background: allSel ? '#4f46e522' : partSel ? '#4f46e50d' : 'transparent',
              color: allSel ? '#4f46e5' : partSel ? '#4f46e5aa' : '#64748b',
            }}>전체</button>
          );
        })()}
        {INCIDENT_GROUPS.map(({ key, label, color }) => {
          const grpIds = employees.filter(e => getIncidentGroup(e, disasterKey) === key).map(e => e.emp_no);
          if (grpIds.length === 0) return null;
          const selCount = grpIds.filter(id => selected.has(id)).length;
          const allSel = selCount === grpIds.length;
          const partSel = selCount > 0 && !allSel;
          return (
            <button key={key} type="button" onClick={() => applyParticipant(grpIds, !allSel)} style={{
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
        const grpEmps = employees.filter(e => getIncidentGroup(e, disasterKey) === grpKey);
        if (grpEmps.length === 0) return null;
        const selCount = grpEmps.filter(e => selected.has(e.emp_no)).length;
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

        const toggleGrpSel = () => applyParticipant(grpEmps.map(e => e.emp_no), !allSel);

        const mkEmpRow = (emp: EmployeeDB, c: string) => {
          const checked = selected.has(emp.emp_no);
          const ttsChecked = ttsSelected?.has(emp.emp_no) ?? false;
          return (
            <div key={emp.emp_no} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '5px 4px' }}>
              <div onClick={() => applyParticipant([emp.emp_no], !checked)} style={{ display: 'flex', alignItems: 'center', gap: '9px', flex: 1, minWidth: 0, cursor: 'pointer' }}>
                <div style={{ width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0, border: `2px solid ${checked ? c : 'rgba(11,37,69,0.18)'}`, background: checked ? c + '33' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {checked && <span style={{ color: c, fontSize: '9px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: '12px', flex: 1, color: checked ? 'var(--text-main)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.name}</span>
                <span style={{ fontSize: '10px', color: '#475569', flexShrink: 0 }}>{emp.role}</span>
              </div>
              {setTtsSelected && (
                <label onClick={e => e.stopPropagation()} style={{
                  display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', flexShrink: 0,
                  padding: '2px 5px', borderRadius: '5px',
                  border: `1px solid ${ttsChecked ? '#ef4444aa' : 'rgba(239,68,68,0.25)'}`,
                  background: ttsChecked ? '#ef444422' : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={ttsChecked}
                    onChange={() => setTtsSelected(prev => {
                      const next = new Set(prev); next.has(emp.emp_no) ? next.delete(emp.emp_no) : next.add(emp.emp_no); return next;
                    })}
                    style={{ width: '12px', height: '12px', accentColor: '#ef4444', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '9px', color: '#ef4444', fontWeight: 800 }}>TTS</span>
                </label>
              )}
            </div>
          );
        };

        return (
          <div key={grpKey} style={{ borderBottom: `1px solid ${color}33` }}>
            <div onClick={() => setOpenAccordions(prev => { const next = new Set(prev); next.has(grpKey) ? next.delete(grpKey) : next.add(grpKey); return next; })} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', cursor: 'pointer', borderLeft: `3px solid ${selCount > 0 ? color : 'rgba(11,37,69,0.09)'}`, background: selCount > 0 ? color + '08' : 'transparent' }}>
              <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: selCount > 0 ? color : 'var(--text-muted)' }}>{grpKey}</span>
              <span style={{ fontSize: '11px', color: selCount > 0 ? color : '#475569', fontWeight: 600 }}>{selCount}/{grpEmps.length}명</span>
              <button type="button" onClick={e => { e.stopPropagation(); toggleGrpSel(); }} style={{ padding: '3px 9px', borderRadius: '5px', fontSize: '10px', fontWeight: 700, border: `1px solid ${allSel ? color : color + '55'}`, background: allSel ? color + '22' : 'transparent', color: allSel ? color : color + 'aa', cursor: 'pointer', flexShrink: 0, marginLeft: '6px' }}>{allSel ? '해제' : '선택'}</button>
              <span style={{ fontSize: '11px', color: '#475569', marginLeft: '4px' }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
              <div style={{ background: 'rgba(11,37,69,0.025)', padding: '2px 12px 8px' }}>
                {grpKey === '교대' ? (
                  (['A', 'B', 'C', 'D'] as const).map(cho => {
                    const choEmps = grpEmps.filter(e => e.role.includes(cho + '조'));
                    if (choEmps.length === 0) return null;
                    const cc = ({ A: '#4f46e5', B: '#86efac', C: '#fdba74', D: '#f9a8d4' } as Record<string, string>)[cho];
                    const choSel = choEmps.filter(e => selected.has(e.emp_no)).length;
                    const allChoSel = choSel === choEmps.length;
                    return (
                      <div key={cho}>
                        <div onClick={() => applyParticipant(choEmps.map(e => e.emp_no), !allChoSel)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 4px 3px', cursor: 'pointer', borderBottom: '1px solid rgba(11,37,69,0.045)', marginBottom: '2px' }}>
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
                    const tSel = teamEmps.filter(e => selected.has(e.emp_no)).length;
                    const allTSel = tSel === teamEmps.length;
                    return (
                      <div key={team} style={{ marginBottom: '3px' }}>
                        <div onClick={() => applyParticipant(teamEmps.map(e => e.emp_no), !allTSel)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 4px 2px', cursor: 'pointer', borderBottom: '1px solid rgba(11,37,69,0.045)', marginBottom: '2px' }}>
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
        {showTotalPrefix ? '총 ' : ''}<strong style={{ color: 'var(--text-main)' }}>{selected.size}명</strong> 선택{footerSuffix || ''}
        {setTtsSelected && (
          <span style={{ marginLeft: '8px', color: '#ef4444' }}>
            📞 TTS <strong>{ttsSelected!.size}명</strong>
          </span>
        )}
      </div>
    </div>
  );
};

export const CommanderDashboard: React.FC<CommanderDashboardProps> = ({
  activeIncident,
  responders,
  tasks,
  currentUser,
  employees,
  isCommander,
}) => {
  const [selectedDisasterKey, setSelectedDisasterKey] = useState('화재');
  const [selectedMode, setSelectedMode] = useState<'훈련' | '실제'>('훈련');
  // 화재 전용 서브모드: 'initial'=감지기동작, 'full'=전체
  const [fireSubMode, setFireSubMode] = useState<'initial' | 'full'>('initial');
  // 화재 전용 주간/야간 — 지휘관이 발령 시 직접 선택 (다른 재난은 항상 'day')
  const [fireShift, setFireShift] = useState<'day' | 'night'>('day');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);

  // 참여인원 인라인 패널
  const [showParticipants, setShowParticipants] = useState(false);
  const [selectedEmps, setSelectedEmps] = useState<Set<string>>(new Set());
  const [openAccordions, setOpenAccordions] = useState<Set<string>>(new Set());
  // 훈련 중 TTS 즉시발신 대상 — 체크된 사람에게만 감(2026-07-24, 참여 여부와 독립)
  const [ttsEmps, setTtsEmps] = useState<Set<string>>(new Set());

  // 전체훈련 승격 시 나머지 대원 선택
  const [escalateEmps, setEscalateEmps] = useState<Set<string>>(new Set());
  const [escalateTtsEmps, setEscalateTtsEmps] = useState<Set<string>>(new Set());
  const [showEscalatePanel, setShowEscalatePanel] = useState(false);

  // 대원 출동현황 아코디언
  const [showResponders, setShowResponders] = useState(true);
  const [openEscalateAccordions, setOpenEscalateAccordions] = useState<Set<string>>(new Set());
  // 모니터링 탭: 출동현황 | 활동기록 | AI보고서
  const [activeMonitorTab, setActiveMonitorTab] = useState<'roster' | 'log' | 'ai'>('roster');
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const isFireDisaster = selectedDisasterKey === '화재';

  // 재난이 바뀌거나(새 발령) 종료되면 이전 재난의 AI보고서·탭 선택이 남아있지 않도록 초기화.
  // (없으면: 이전 재난에서 본 AI보고서 텍스트가 새 재난 화면에 그대로 남아 오인 위험 — 2026-07-20 발견)
  useEffect(() => {
    setAiReport(null);
    setActiveMonitorTab('roster');
  }, [activeIncident?.id]);

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
    } catch {
      // AI 보고서는 Anthropic API(유료) 호출이 필요함 — API 키/크레딧 미설정 시
      // 실제 오류(500, 시크릿 누락 등) 대신 관리자가 조치할 수 있는 안내를 표시
      setAiReport('⚠️ AI 보고서 기능은 유료 구독(Anthropic API 크레딧)이 필요합니다.\n관리자에게 문의해 API 키를 설정해주세요.');
    } finally {
      setAiLoading(false);
    }
  };

  const fmtTime = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
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
    const shift = isFireDisaster ? fireShift : 'day';
    const shiftLabel = isFireDisaster ? (fireShift === 'night' ? ' · 야간' : ' · 주간') : '';

    if (!window.confirm(`[${modeLabel}${shiftLabel}] ${selectedDisasterKey} 발령하시겠습니까?\n위치: ${location}\n소집: ${subLabel}`)) return;

    setLoading(true);
    try {
      const scope = isInitial ? 'fire_initial' : (selectedMode === '훈련' ? 'drill' : 'all');
      // 훈련이고 참여인원을 선택했으면 drill_emp_nos 로 발령 시점부터 푸시 대상을 제한
      const drillEmpNos = selectedMode === '훈련' && selectedEmps.size > 0
        ? [...selectedEmps].join(',')
        : null;
      // 훈련 참여인원설정에서 사람별로 체크한 TTS 즉시발신 대상 — 비어있으면 아무도 전화 안 받음
      const ttsEmpNos = selectedMode === '훈련' && ttsEmps.size > 0
        ? [...ttsEmps].join(',')
        : null;
      const allRoles = await db.getDisasterRolesWithTasks(selectedDisasterKey, shift);
      if (!allRoles.length) throw new Error('임무 데이터가 없습니다. 재난대응메뉴얼에서 이 재난·근무의 역할을 먼저 등록하세요.');

      // 감지기동작이면 초기출동조 역할만 발령
      const roles = isInitial
        ? allRoles.filter(r => FIRE_INITIAL_BADGES.has(r.badge))
        : allRoles;

      // 화재는 위치 텍스트에 특정 구역 키워드가 있으면 발령 즉시 상황(variant)을 자동 확정
      const autoVariant = isFireDisaster ? detectVariantFromLocation(location.trim()) : null;

      const incident = await db.declareIncident(
        selectedDisasterKey, modeLabel, location.trim(), scope, currentUser.empNo, drillEmpNos, shift,
        ttsEmpNos, autoVariant
      );

      const bulkTasks: Omit<MemberTask, 'updated_at' | 'done_by'>[] = [];
      roles.forEach(role => {
        (role.disaster_tasks ?? [])
          .sort((a, b) => a.task_idx - b.task_idx)
          .forEach(task => {
            bulkTasks.push({
              id: `${incident.id}_${role.id}_${task.task_idx}`,
              incident_id: incident.id,
              emp_no: '',
              role: role.role,
              task_idx: task.task_idx,
              label: task.label,
              done: false,
              variant: task.variant ?? null,
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
        setEscalateTtsEmps(new Set(ttsEmps));
        setShowEscalatePanel(true);
      } else {
        setEscalateEmps(new Set());
        setEscalateTtsEmps(new Set());
        setShowEscalatePanel(false);
      }

      // FCM 직접 호출 (pg_net 트리거 백업 + drill_emp_nos 필터)
      await db.sendIncidentPush(incident, 'INSERT', null, drillEmpNos);
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
    // 훈련 참여인원설정에서 사람별로 체크한 TTS 즉시발신 대상
    const ttsEmpNos = isTraining && escalateTtsEmps.size > 0
      ? [...escalateTtsEmps].join(',')
      : null;

    const participantDesc = isTraining
      ? (escalateEmps.size > 0 ? `선택 대원 ${escalateEmps.size}명` : '나머지 전원')
      : '나머지 대원 전원';

    if (!window.confirm(`[${label}]으로 승격하시겠습니까?\n소집: ${participantDesc}`)) return;

    setLoading(true);
    try {
      await db.escalateIncident(activeIncident.id, newMode, newScope, drillEmpNos, ttsEmpNos);

      // 선택 대원을 responders에 추가 (훈련 + 선택 대원 있을 때)
      if (isTraining && escalateEmps.size > 0) {
        const selectedEmployees = employees.filter(e => escalateEmps.has(e.emp_no));
        await db.setTrainingParticipants(activeIncident.id, selectedEmployees, responders);
      }

      // 아직 생성되지 않은 역할의 임무만 추가
      const allRoles = await db.getDisasterRolesWithTasks(activeIncident.disaster, activeIncident.shift ?? 'day');
      const existingRoles = new Set(tasks.map(t => t.role));
      const newRoles = allRoles.filter(r => !existingRoles.has(r.role));

      const bulkTasks: Omit<MemberTask, 'updated_at' | 'done_by'>[] = [];
      newRoles.forEach(role => {
        (role.disaster_tasks ?? [])
          .sort((a, b) => a.task_idx - b.task_idx)
          .forEach(task => {
            bulkTasks.push({
              id: `${activeIncident.id}_${role.id}_${task.task_idx}`,
              incident_id: activeIncident.id,
              emp_no: '',
              role: role.role,
              task_idx: task.task_idx,
              label: task.label,
              done: false,
              variant: task.variant ?? null,
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
      setTtsEmps(new Set());
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

  // 상황 확정(variant) — 하드코딩 없이 이 재난의 임무들에 실제로 붙어있는 variant 값에서 동적 생성.
  // variant 임무가 하나도 없는 재난(정전·지진·승강기 등)은 이 배열이 비어 UI가 렌더되지 않음.
  const availableVariants = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => { if (t.variant) set.add(t.variant); });
    return [...set];
  }, [tasks]);

  // 상황 확정 권한 — isCommander와 무관하게 별도 지정(전기파트장은 isCommander=false라 이 체크가 필요).
  // 출동조장(전기파트장) · 어드민(소방파트장) · 주야간 상황 담당(야소방)만 확정 가능.
  const currentEmployee = employees.find(e => e.emp_no === currentUser.empNo);
  const canConfirmVariant =
    currentEmployee?.team === '전기파트장' ||
    currentEmployee?.team === '소방파트장' ||
    currentEmployee?.dept_code === '야소방';

  const handleSetVariant = async (variant: string | null) => {
    if (!activeIncident) return;
    try {
      await db.setIncidentVariant(activeIncident.id, variant);
    } catch (err: any) {
      alert('상황 확정 중 오류가 발생했습니다: ' + err.message);
    }
  };

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
          '출동중': { icon: '🚗', color: '#c2410c' },
          '현장':   { icon: '📍', color: '#0284c7' },
          '복귀':   { icon: '🏁', color: '#16a34a' },
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
          color: '#0f9d63',
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
          {/* 타임라인 스텝형 발령 폼 (2026-07-29 개편) — 번호 노드 + 세로 연결선.
              2단계(발령 구분)는 훈련=남색 톤, 실제=적색 톤으로 대비. 접힌 "실제상황" 줄은
              선택되지 않은 상태에서도 굵은 적색 테두리 + 큰 화살표로 눈에 띄게 처리. */}
          <form onSubmit={handleDeclare} style={{ position: 'relative', paddingLeft: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ position: 'absolute', left: '11px', top: '11px', bottom: '11px', width: '2px', background: 'var(--border-glow)' }} />

            {/* 1. 재난 유형 */}
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: '-28px', top: 0, width: '22px', height: '22px', borderRadius: '50%',
                background: '#0d1f36', color: '#fff', fontSize: '11px', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px var(--bg-app)',
              }}>1</span>
              <label htmlFor="disaster-select" style={{ fontSize: '12px', fontWeight: 800, color: '#0d1f36', textTransform: 'none', letterSpacing: 'normal', marginBottom: '6px' }}>
                재난 유형
              </label>
              <select id="disaster-select" value={selectedDisasterKey}
                onChange={(e) => { setSelectedDisasterKey(e.target.value); setFireSubMode('initial'); }}
              >
                {DISASTERS.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>

            {/* 2. 훈련 / 실제 상황 선택 */}
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: '-28px', top: 0, width: '22px', height: '22px', borderRadius: '50%',
                background: '#0d1f36', color: '#fff', fontSize: '11px', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px var(--bg-app)',
              }}>2</span>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0d1f36', marginBottom: '6px' }}>
                훈련 / 실제 상황 선택
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(['훈련', '실제'] as const).map(mode => {
                  const isSel = selectedMode === mode;
                  const isReal = mode === '실제';
                  const color = isReal ? '#dc2626' : '#0d1f36';
                  const modeLabel = mode === '훈련' ? '🎓 훈련상황' : '⚠️ 실제상황';
                  const subOptions = isFireDisaster
                    ? mode === '훈련'
                      ? [{ key: 'initial' as const, icon: '🔔', label: '감지기동작' }, { key: 'full' as const, icon: '🎯', label: '전체훈련' }]
                      : [{ key: 'initial' as const, icon: '🔔', label: '감지기동작' }, { key: 'full' as const, icon: '🔥', label: '화재상황' }]
                    : [];
                  const subLabel = isSel && isFireDisaster
                    ? (fireSubMode === 'initial' ? '감지기동작' : mode === '훈련' ? '전체훈련' : '화재상황')
                    : '';
                  // 접혀 있어도 "실제상황"만은 굵은 적색 테두리·배경·큰 화살표로 강조 (위급 옵션임을 항상 표시)
                  const collapsedUrgent = !isSel && isReal;
                  return (
                    <div key={mode} style={{
                      border: `${isSel || collapsedUrgent ? 2 : 1.5}px solid ${isSel || collapsedUrgent ? color : 'rgba(11,37,69,0.12)'}`,
                      borderRadius: '12px', overflow: 'hidden',
                      background: isSel ? color + '14' : collapsedUrgent ? '#fdeeee' : 'transparent',
                      boxShadow: isSel ? `0 2px 8px ${color}33` : 'none',
                      transition: 'all 0.2s',
                    }}>
                      <div
                        onClick={() => setSelectedMode(mode)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '12px 14px', cursor: 'pointer',
                          borderLeft: `6px solid ${isSel ? color : 'transparent'}`,
                        }}
                      >
                        {isSel && (
                          <span style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                            background: color, color: '#fff', fontSize: '12px', fontWeight: 900,
                          }}>✓</span>
                        )}
                        <span style={{ fontSize: '15px', fontWeight: isSel || collapsedUrgent ? 900 : 700, color: isSel || collapsedUrgent ? color : '#475569', flex: 1 }}>
                          {modeLabel}
                        </span>
                        {subLabel && (
                          <span style={{ fontSize: '11px', color: color, fontWeight: 800 }}>{subLabel}</span>
                        )}
                        <span style={{ fontSize: collapsedUrgent ? '20px' : '10px', fontWeight: 800, color: collapsedUrgent ? color : '#475569', lineHeight: 1 }}>
                          {isSel ? (isFireDisaster ? '▲' : '') : (collapsedUrgent ? '▸' : (isFireDisaster ? '▶' : ''))}
                        </span>
                      </div>
                      {isSel && isFireDisaster && (
                        <div style={{
                          display: 'flex', flexDirection: 'column', gap: '8px',
                          padding: '4px 12px 12px',
                          borderTop: `1px solid ${color}22`,
                        }}>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {subOptions.map(opt => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={e => { e.stopPropagation(); setFireSubMode(opt.key); }}
                                style={{
                                  flex: 1, padding: '13px 0', borderRadius: '10px', cursor: 'pointer',
                                  fontSize: '13px', fontWeight: 800,
                                  background: fireSubMode === opt.key ? color : '#ffffff',
                                  border: `1px solid ${fireSubMode === opt.key ? color : 'rgba(11,37,69,0.12)'}`,
                                  color: fireSubMode === opt.key ? '#fff' : '#64748b',
                                  transition: 'all 0.15s',
                                }}
                              >
                                {opt.icon} {opt.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {([{ key: 'day' as const, icon: '☀️', label: '주간' }, { key: 'night' as const, icon: '🌙', label: '야간' }]).map(opt => (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={e => { e.stopPropagation(); setFireShift(opt.key); }}
                                style={{
                                  flex: 1, padding: '13px 0', borderRadius: '10px', cursor: 'pointer',
                                  fontSize: '13px', fontWeight: 800,
                                  background: fireShift === opt.key ? color : '#ffffff',
                                  border: `1px solid ${fireShift === opt.key ? color : 'rgba(11,37,69,0.12)'}`,
                                  color: fireShift === opt.key ? '#fff' : '#64748b',
                                  transition: 'all 0.15s',
                                }}
                              >
                                {opt.icon} {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. 재난 발생 위치 */}
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: '-28px', top: 0, width: '22px', height: '22px', borderRadius: '50%',
                background: '#0d1f36', color: '#fff', fontSize: '11px', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px var(--bg-app)',
              }}>3</span>
              <label htmlFor="location-input" style={{ fontSize: '12px', fontWeight: 800, color: '#0d1f36', textTransform: 'none', letterSpacing: 'normal', marginBottom: '6px' }}>
                재난 발생 위치
              </label>
              <input id="location-input" type="text"
                placeholder="예: 서관 3층 어린이집 옆, 지하 1층 변전실"
                value={location} onChange={(e) => setLocation(e.target.value)} required
              />
            </div>

            {/* 4. 훈련 시 참여인원 — 인라인 그리드 */}
            {selectedMode === '훈련' && (
              <div style={{ position: 'relative' }}>
                <span style={{
                  position: 'absolute', left: '-28px', top: 0, width: '22px', height: '22px', borderRadius: '50%',
                  background: '#0d1f36', color: '#fff', fontSize: '11px', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px var(--bg-app)',
                }}>4</span>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#0d1f36', marginBottom: '6px' }}>
                  훈련인원 설정
                </div>
                <button type="button"
                  onClick={() => setShowParticipants(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                    border: '1px solid rgba(99,102,241,0.4)',
                    background: showParticipants ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.08)',
                    color: '#4f46e5', fontSize: '13px', fontWeight: 700,
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
                  <EmployeeGroupPicker
                    employees={employees}
                    disasterKey={selectedDisasterKey}
                    selected={selectedEmps}
                    setSelected={setSelectedEmps}
                    openAccordions={openAccordions}
                    setOpenAccordions={setOpenAccordions}
                    wrapperBorderColor="rgba(99,102,241,0.2)"
                    ttsSelected={ttsEmps}
                    setTtsSelected={setTtsEmps}
                  />
                )}
              </div>
            )}

            {/* 5. 비상 발령 */}
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: '-28px', top: 0, width: '22px', height: '22px', borderRadius: '50%',
                background: '#dc2626', color: '#fff', fontSize: '11px', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 4px var(--bg-app)',
              }}>5</span>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0d1f36', marginBottom: '6px' }}>
                비상 발령
              </div>
              <button type="submit" className="btn btn-danger" disabled={loading}>
                <Play size={18} fill="white" />
                즉시 비상 발령 (사이렌/임무 생성)
              </button>
            </div>
          </form>

        </>
        )
      ) : (
        // ── 발령 중 모니터링 ────────────────────────
        <>
          {/* 상황 확정(variant) — variant 임무가 있는 재난에서만 표시 */}
          {availableVariants.length > 0 && canConfirmVariant && (
            <div className="card" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>상황:</span>
                <button
                  type="button"
                  onClick={() => handleSetVariant(null)}
                  style={{
                    padding: '6px 12px', borderRadius: '999px', cursor: 'pointer',
                    fontSize: '12px', fontWeight: 700,
                    background: !activeIncident?.variant ? 'rgba(148,163,184,0.25)' : 'rgba(11,37,69,0.05)',
                    border: `1px solid ${!activeIncident?.variant ? 'rgba(148,163,184,0.6)' : 'rgba(11,37,69,0.12)'}`,
                    color: !activeIncident?.variant ? 'var(--text-main)' : 'var(--text-muted)',
                  }}
                >
                  공통
                </button>
                {availableVariants.map(v => {
                  const active = activeIncident?.variant === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => handleSetVariant(v)}
                      style={{
                        padding: '6px 12px', borderRadius: '999px', cursor: 'pointer',
                        fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap',
                        background: active ? 'rgba(239,68,68,0.22)' : 'rgba(11,37,69,0.05)',
                        border: `1px solid ${active ? 'rgba(239,68,68,0.6)' : 'rgba(11,37,69,0.12)'}`,
                        color: active ? '#dc2626' : 'var(--text-muted)',
                      }}
                    >
                      {VARIANT_LABELS[v] ?? v}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
              <div className="progress-fill" style={{ width: `${overallProgressPct}%`, background: 'linear-gradient(90deg, #0f9d63 0%, #059669 100%)' }}></div>
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
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', flexShrink: 0, borderBottom: showResponders ? '1px solid rgba(11,37,69,0.06)' : 'none' }}
            >
              <Users size={18} color="var(--color-water)" />
              <span style={{ flex: 1, fontSize: '14px', fontWeight: 700 }}>
                대원 출동 현황
                {activeIsInitial && <span style={{ fontSize: '11px', color: '#d9820a', marginLeft: '6px' }}>초기출동조</span>}
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
                <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid rgba(11,37,69,0.06)' }}>
                  {([
                    { key: 'roster' as const, label: '👥 출동', color: '#0284c7' },
                    { key: 'log'    as const, label: '📋 활동', color: '#7c3aed' },
                    { key: 'ai'     as const, label: '🤖 AI보고서', color: '#0f9d63' },
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
                          let dotColor = 'var(--text-muted)';
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
                                <span style={{ fontSize: '13px', fontWeight: 700 }}>{responderStatusLabel(resp.status)}</span>
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
                          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '8px 0', borderBottom: i < activityLog.length - 1 ? '1px solid rgba(11,37,69,0.045)' : 'none' }}>
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
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f9d63' }}>AI가 상황을 분석 중입니다...</div>
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
                          fontSize: '12px', lineHeight: 1.8, color: 'var(--text-main)',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {aiReport.split('\n').map((line, i) => {
                            if (line.startsWith('## ')) return <div key={i} style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-main)', margin: '6px 0 8px', paddingBottom: '4px', borderBottom: '1px solid rgba(11,37,69,0.12)' }}>{line.replace('## ', '')}</div>;
                            if (line.startsWith('**') && line.endsWith('**')) return <div key={i} style={{ fontSize: '12px', fontWeight: 700, color: '#0f9d63', margin: '10px 0 4px' }}>{line.replace(/\*\*/g, '')}</div>;
                            if (line.trim() === '') return <div key={i} style={{ height: '4px' }} />;
                            return <div key={i} style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.7 }}>{line}</div>;
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
                          color: '#4f46e5', fontSize: '13px', fontWeight: 700,
                        }}>
                        <span>선택 : 2차 소집 대원</span>
                        <span style={{ fontSize: '12px', opacity: 0.8 }}>
                          {escalateEmps.size}명 / {employees.length}명 {showEscalatePanel ? '▲' : '▼'}
                        </span>
                      </button>

                      {showEscalatePanel && (
                        <EmployeeGroupPicker
                          employees={employees}
                          disasterKey={activeIncident!.disaster}
                          selected={escalateEmps}
                          setSelected={setEscalateEmps}
                          openAccordions={openEscalateAccordions}
                          setOpenAccordions={setOpenEscalateAccordions}
                          wrapperBorderColor="rgba(165,180,252,0.2)"
                          footerSuffix=" (선택 대원에게만 알람 발송)"
                          showTotalPrefix={false}
                          ttsSelected={escalateTtsEmps}
                          setTtsSelected={setEscalateTtsEmps}
                        />
                      )}
                    </div>
                  )}

                  <button onClick={handleFireEscalate} className="btn" disabled={loading}
                    style={{
                      background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(220,38,38,0.14))',
                      border: '1px solid rgba(220,38,38,0.35)',
                      color: '#b91c1c',
                    }}
                  >
                    {!activeIsTraining ? '🔥 화재상황으로 승격 (나머지 대원 소집)' : '🎯 2차 출동 발령'}
                  </button>
                </>
              )}

              <button onClick={handleClose} className="btn" disabled={loading}
                style={{
                  background: 'rgba(37,99,235,0.06)',
                  border: '1px solid rgba(37,99,235,0.4)',
                  color: '#2563eb',
                }}
              >
                <Square size={16} fill="#2563eb" />
                상황 종료 및 리셋
              </button>
            </div>
          )}
        </>
      )}

    </div>
  );
};
