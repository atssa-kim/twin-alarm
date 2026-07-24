import React, { useEffect, useRef, useState, useMemo } from 'react';
import { type Incident, type Responder, type MemberTask, type DisasterRole, type DisasterTask, db, supabase, isIncidentParticipant } from '../services/supabase';
import { type Employee } from './Login';
import { Check, ShieldAlert, MapPin, Award, CheckSquare, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { unlockAudio } from '../utils/audio';
import { DISASTERS, FIRE_INITIAL_BADGES } from '../data/disasters';
import { findEquipmentLocation } from '../data/equipmentLocations';
import { VARIANT_LABELS } from './CommanderDashboard';

interface ResponderViewProps {
  activeIncident: Incident | null;
  responders: Responder[];
  tasks: MemberTask[];
  currentUser: Employee;
  disasterRoles: DisasterRole[];
}

// ── 아코디언 그룹 파싱 ──────────────────────────────────────
type StandaloneGroup = { type: 'standalone'; task: MemberTask };
type AccordionGroup  = { type: 'group'; header: MemberTask; children: MemberTask[] };
type TaskGroup = StandaloneGroup | AccordionGroup;

function groupTasks(tasks: MemberTask[]): TaskGroup[] {
  const result: TaskGroup[] = [];
  let current: AccordionGroup | null = null;

  for (const task of tasks) {
    const label = task.label;
    if (label.startsWith('◇') || label.startsWith('◆')) {
      if (current) result.push(current);
      current = { type: 'group', header: task, children: [] };
    } else if ((label.startsWith('┖') || label.startsWith('└')) && current) {
      current.children.push(task);
    } else {
      if (current) { result.push(current); current = null; }
      result.push({ type: 'standalone', task });
    }
  }
  if (current) result.push(current);
  return result;
}

const stripPrefix = (label: string) => label.replace(/^[◇◆┖└]\s*/, '');

// 화재: 이 배지(또는 "대응1"처럼 번호가 붙은 세분화 배지 포함)의 조장(파트장)이 임무를 체크하면,
// 이미 출동체크한 조원도 자동으로 현장 처리. 접두어 매칭이라 대응1~4처럼 세분화돼도 코드
// 수정 없이 그대로 동작함. 대상은 원래부터 출동/대응/구조 3계열뿐이며, 유도/지원 계열은
// 포함되지 않음(2026-07-20 기준 — 필요하면 배지 추가 검토).
const FIRE_LEADER_AUTO_BADGE_PREFIXES = ['출동', '대응', '구조'];
function isFireLeaderAutoBadge(badge: string): boolean {
  return FIRE_LEADER_AUTO_BADGE_PREFIXES.some(p => badge.startsWith(p));
}

// 비상장구 목록은 1단계(출동)에 이미 표시되므로, 다른 단계의 임무 문구에서는 중복되지 않게 제거
function stripEquipmentClause(text: string): string {
  return text.replace(/비상장(?:구|비)[_:\s]*[^\n]+?\s*(?:휴대|지참|착용)\s*(?:후)?\s*/, '').trim();
}

// 임무 전체가 "비상장구_..." 하나로만 이루어진 줄인지 판별 — 뒤에 붙는 동사(휴대/지참/착용)나
// "-화재층 출동" 같은 부가 문구 유무와 무관하게, 모두 1단계 비상장구 안내로 모으기 위함
function isEquipmentOnlyTask(label: string): boolean {
  return /^비상장(?:구|비)[_:\s]/.test(stripPrefix(label));
}

// "행동)... / 무전)..." 패턴을 행동요령 / 무전 예시로 분리 (없으면 radio는 null)
function splitRadio(label: string): { instruction: string; radio: string | null } {
  const clean = stripPrefix(label);
  const m = clean.match(/^(?:행동\))?(.*?)\s*\/\s*무전\)\s*(.*)$/);
  if (m && m[2]) return { instruction: m[1].trim(), radio: m[2].trim() };
  return { instruction: clean.replace(/^행동\)\s*/, ''), radio: null };
}

// 임무 텍스트에서 "비상장구_A,B,C (휴대/지참/착용 | -지역 출동 등)" 패턴을 장비 목록으로 추출.
// 뒤에 붙는 동사가 없는 경우("...-화재층 출동")도 인식하도록 두 패턴 모두 제거를 시도.
function parseEquipmentList(label: string): string[] {
  const clean = stripPrefix(label);
  const m = clean.match(/^비상장(?:구|비)[_:\s]*(.+)$/);
  if (!m) return [];
  let rest = m[1];
  rest = rest.replace(/\s*(?:휴대|지참|착용)\s*(?:후)?\s*.*$/, '');
  rest = rest.replace(/[-–]\s*[^,·]*(?:출동|이동|현장).*$/, '');
  return rest.split(/[,·]/).map(s => s.trim()).filter(Boolean);
}

// ── 단계별 임무수행: 체크박스 1줄 ──────────────────────────────
const StepCheckRow: React.FC<{ checked: boolean; label: string; onClick: () => void; big?: boolean }> = ({ checked, label, onClick, big }) => (
  <div className={`task-item ${checked ? 'done' : ''}`} onClick={onClick} style={{ padding: '16px' }}>
    <div className="checkbox-visual" style={{ width: big ? '30px' : '26px', height: big ? '30px' : '26px', flexShrink: 0 }}>
      <Check size={big ? 20 : 18} strokeWidth={3} />
    </div>
    <div className="task-label" style={{ fontSize: big ? '21px' : '17px', fontWeight: 800 }}>{label}</div>
  </div>
);

// disa_app 과 동일한 번호 계산 (task_idx 순서 기준)
function computeTaskNumMap(tasks: MemberTask[]): Record<string, string> {
  const map: Record<string, string> = {};
  let main = 0, sub = 0;
  tasks.forEach(t => {
    const l = t.label;
    if (l.startsWith('┖') || l.startsWith('└')) {
      if (main > 0) { sub++; map[t.id] = `${main}-${sub}`; }
    } else {
      main++; sub = 0;
      map[t.id] = String(main).padStart(2, '0');
    }
  });
  return map;
}

// 실제 임무 체크리스트(목록뷰, 파란 테마)와 자가 수행률 미리보기(다른 배지 미리보기, 보라 테마)가
// 거의 동일한 아코디언 구조라 공통 컴포넌트로 추출함(2026-07-20). 색상만 theme으로 넘겨받는다.
interface TaskChecklistTheme {
  headerBg: string;
  headerBorder: string;
  chevronColor: string;
  labelColor: string;
  bodyBorder: string;
}

const TaskChecklistBody: React.FC<{
  groups: TaskGroup[];
  numMap: Record<string, string>;
  openGroups: Set<string>;
  onToggleGroup: (id: string) => void;
  onToggleTask: (task: MemberTask) => void;
  theme: TaskChecklistTheme;
}> = ({ groups, numMap, openGroups, onToggleGroup, onToggleTask, theme }) => (
  <>
    {groups.map((group, gi) => {
      if (group.type === 'standalone') {
        const task = group.task;
        const num = numMap[task.id] ?? String(gi + 1).padStart(2, '0');
        return (
          <div key={task.id} className={`task-item ${task.done ? 'done' : ''}`} onClick={() => onToggleTask(task)}>
            <div className="checkbox-visual"><Check size={14} strokeWidth={3} /></div>
            <div className="task-label">
              <span style={{ color: 'var(--text-muted)', fontWeight: 700, marginRight: '4px', fontSize: '11px' }}>{num}</span>
              {stripPrefix(task.label)}
            </div>
          </div>
        );
      }

      const isOpen = openGroups.has(group.header.id);
      const doneCount = group.children.filter(c => c.done).length;
      const total = group.children.length;
      const headerNum = numMap[group.header.id] ?? String(gi + 1).padStart(2, '0');

      return (
        <div key={group.header.id}>
          <div
            onClick={() => onToggleGroup(group.header.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 14px',
              background: theme.headerBg, border: `1px solid ${theme.headerBorder}`,
              borderRadius: isOpen ? '10px 10px 0 0' : '10px',
              cursor: 'pointer', userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
              {isOpen
                ? <ChevronDown size={15} color={theme.chevronColor} style={{ flexShrink: 0 }} />
                : <ChevronRight size={15} color={theme.chevronColor} style={{ flexShrink: 0 }} />
              }
              <span style={{
                fontSize: '13px', fontWeight: 700, color: theme.labelColor,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <span style={{ color: theme.chevronColor, fontWeight: 700, marginRight: '4px', fontSize: '11px' }}>TASK {headerNum}</span>
                {stripPrefix(group.header.label)}
              </span>
            </div>
            <span style={{
              fontSize: '11px', fontWeight: 700, flexShrink: 0, marginLeft: '8px',
              color: doneCount === total && total > 0 ? '#059669' : '#64748b',
            }}>
              {doneCount}/{total}
            </span>
          </div>

          {isOpen && (
            <div style={{
              border: `1px solid ${theme.bodyBorder}`, borderTop: 'none',
              borderRadius: '0 0 10px 10px', overflow: 'hidden',
              marginBottom: gi < groups.length - 1 ? '2px' : '0',
            }}>
              {group.children.map((child, ci) => {
                const childNum = numMap[child.id] ?? `${gi + 1}-${ci + 1}`;
                return (
                  <div
                    key={child.id}
                    className={`task-item ${child.done ? 'done' : ''}`}
                    onClick={() => onToggleTask(child)}
                    style={{
                      borderRadius: 0,
                      borderBottom: ci < group.children.length - 1 ? '1px solid rgba(11,37,69,0.045)' : 'none',
                      paddingLeft: '20px', marginBottom: 0,
                    }}
                  >
                    <div className="checkbox-visual"><Check size={14} strokeWidth={3} /></div>
                    <div className="task-label">
                      <span style={{ color: 'var(--text-muted)', fontWeight: 700, marginRight: '4px', fontSize: '11px' }}>{childNum}</span>
                      {stripPrefix(child.label)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    })}
  </>
);

export const ResponderView: React.FC<ResponderViewProps> = ({
  activeIncident,
  responders,
  tasks,
  currentUser,
  disasterRoles
}) => {
  const [statusLoading, setStatusLoading] = useState(false);
  const [myBadge, setMyBadge] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [optimisticDone, setOptimisticDone] = useState<Record<string, boolean>>({});
  const [optimisticStatus, setOptimisticStatus] = useState<Responder['status'] | null>(null);
  const [showChecklist, setShowChecklist] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'step'>('list');
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDetailOpen, setStepDetailOpen] = useState<Set<number>>(new Set());
  const [openEquipment, setOpenEquipment] = useState<string | null>(null);
  const incidentIdRef = useRef<string | null>(null);

  // ── 미리보기 모드 (발령 전 재난 임무 조회) ──────────────────
  const [previewDisaster, setPreviewDisaster] = useState<string | null>(null);
  const [previewRoles, setPreviewRoles] = useState<(DisasterRole & { disaster_tasks: DisasterTask[] })[]>([]);
  const [previewBadge, setPreviewBadge] = useState<string | null>(null);
  const [previewLocalDone, setPreviewLocalDone] = useState<Record<string, boolean>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewOpenGroups, setPreviewOpenGroups] = useState<Set<string>>(new Set());
  // 미리보기 전용 상황별 보기 필터 — 'ALL'(전체) | 'COMMON'(공통, variant 없음) | 실제 variant 값.
  // 발령 후(실제 진행 중) 화면에는 적용하지 않음 — 그쪽은 지휘관이 확정한 상황(activeIncident.variant)
  // 하나만 보여주는 게 의도된 동작이라, 대원이 임의로 다른 상황을 보게 하면 혼선이 생길 수 있음.
  const [previewVariant, setPreviewVariant] = useState<'ALL' | 'COMMON' | string>('ALL');

  useEffect(() => {
    if (!activeIncident) { setMyBadge(null); return; }
    db.getEmployeeBadge(currentUser.empNo, activeIncident.disaster, activeIncident.shift ?? 'day')
      .then(badge => setMyBadge(badge))
      .catch(() => setMyBadge(null));
  }, [activeIncident?.id, currentUser.empNo]);

  // 미리보기: 재난 선택 시 마스터 데이터 로드
  useEffect(() => {
    if (activeIncident || !previewDisaster) {
      setPreviewRoles([]);
      setPreviewBadge(null);
      setPreviewLocalDone({});
      setPreviewOpenGroups(new Set());
      setPreviewVariant('ALL');
      return;
    }
    const load = () => {
      setPreviewLoading(true);
      Promise.all([
        db.getDisasterRolesWithTasks(previewDisaster),
        db.getEmployeeBadge(currentUser.empNo, previewDisaster),
      ]).then(([roles, badge]) => {
        setPreviewRoles(roles);
        setPreviewBadge(badge);
        setPreviewLocalDone({});
        setPreviewVariant('ALL');
        // 모든 그룹 기본 펼침
        const headers = new Set<string>(
          roles
            .flatMap(r => r.disaster_tasks ?? [])
            .filter(t => t.label.startsWith('◇') || t.label.startsWith('◆'))
            .map(t => `preview_${t.id}`)
        );
        setPreviewOpenGroups(headers);
      }).catch(() => {
        setPreviewRoles([]);
        setPreviewBadge(null);
      }).finally(() => setPreviewLoading(false));
    };
    load();

    // 재난대응메뉴얼(외부 앱)에서 임무를 수정/삭제하면 미리보기에 실시간 반영
    const channel = supabase
      .channel(`preview-disaster-roles-${previewDisaster}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disaster_roles' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disaster_tasks' }, load)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [previewDisaster, activeIncident, currentUser.empNo]);

  const currentResponder = responders.find(r => r.emp_no === currentUser.empNo);
  const responderStatus = optimisticStatus ?? (currentResponder ? currentResponder.status : '미응답');

  // Realtime 응답 오면 optimistic 상태 정리
  useEffect(() => {
    if (currentResponder && optimisticStatus === currentResponder.status) {
      setOptimisticStatus(null);
    }
  }, [currentResponder?.status]);

  // 훈련 발령을 특정 대원으로 제한한 경우, 선택 안 된 대원에게는 임무를 보여주지 않음
  const isParticipant = !activeIncident || isIncidentParticipant(activeIncident, currentUser.empNo);

  const myRole = (myBadge && isParticipant)
    ? (disasterRoles.find(r => r.badge === myBadge) ?? null)
    : null;

  const rawTasks = myRole
    ? tasks
        .filter(t => t.role === myRole.role)
        // 상황 확정(variant): 공통 임무(variant 없음)는 항상 표시, variant 있는 임무는 그 상황이
        // 확정된 경우에만 표시. phase 개념 도입 없이 단일 태그 비교로만 처리.
        .filter(t => !t.variant || t.variant === activeIncident?.variant)
        .sort((a, b) => a.task_idx - b.task_idx)
    : [];

  // Optimistic 상태 병합 (Realtime 응답 전 즉시 UI 반영)
  const myTasks = rawTasks.map(t =>
    optimisticDone[t.id] !== undefined ? { ...t, done: optimisticDone[t.id] } : t
  );

  // Realtime으로 실제 DB 상태가 오면 optimistic 캐시 정리
  useEffect(() => {
    if (rawTasks.length === 0) return;
    setOptimisticDone(prev => {
      const next = { ...prev };
      rawTasks.forEach(t => { delete next[t.id]; });
      return next;
    });
  }, [tasks]);

  const taskGroups = useMemo(() => groupTasks(myTasks), [myTasks]);
  const taskNumMap = useMemo(() => computeTaskNumMap(myTasks), [myTasks]);

  // 단계별 보기 전용: "비상장구_..." 임무는 몇 개든 전부 1단계로 모으고, 나머지 임무로만 단계를 구성
  const equipmentTasks = useMemo(() => myTasks.filter(t => isEquipmentOnlyTask(t.label)), [myTasks]);
  const stepTaskGroups = useMemo(
    () => groupTasks(myTasks.filter(t => !isEquipmentOnlyTask(t.label))),
    [myTasks]
  );

  // ── 단계별 임무수행: 출동(1단계, 단독 전체화면) → 임무1 → 임무2 → ... → (마지막 임무 + 복귀) ──
  // 현장도착은 별도 체크박스 없이, 출동 후 임무를 하나 체크하면 자동으로 처리됨(상태 '현장').
  const STEP_PAGE_SIZE = 3;

  type StepFlowItem = {
    group: TaskGroup | null;   // null인 건 출동/정보 전용 1단계뿐
    showDispatch: boolean;
    showReturn: boolean;
    showInfo?: boolean;        // 상황실 전용: 체크박스 없이 경보내용·비상장구만 보여주는 1단계
  };

  const isSituationRoomForStep = myBadge === '상황';

  const stepFlow = useMemo<StepFlowItem[]>(() => {
    if (isSituationRoomForStep) {
      return [
        { group: null, showDispatch: false, showReturn: false, showInfo: true },
        ...stepTaskGroups.map(group => ({ group, showDispatch: false, showReturn: false })),
      ];
    }
    if (stepTaskGroups.length === 0) {
      return [{ group: null, showDispatch: true, showReturn: false }];
    }
    const items: StepFlowItem[] = [
      { group: null, showDispatch: true, showReturn: false },
    ];
    stepTaskGroups.forEach((group, i) => {
      items.push({
        group,
        showDispatch: false,
        showReturn: i === stepTaskGroups.length - 1,
      });
    });
    return items;
  }, [stepTaskGroups, isSituationRoomForStep]);

  const isGroupDone = (group: TaskGroup): boolean =>
    group.type === 'standalone' ? group.task.done : group.children.every(c => c.done);

  const isDispatched = responderStatus === '출동중' || responderStatus === '현장' || responderStatus === '복귀';
  const isReturned = responderStatus === '복귀';

  const isStepDone = (item: StepFlowItem): boolean => {
    if (item.showInfo) return true; // 체크할 항목이 없는 정보 전용 카드
    if (item.showDispatch) return isDispatched;
    let ok = true;
    if (item.group) ok = ok && isGroupDone(item.group);
    if (item.showReturn) ok = ok && isReturned;
    return ok;
  };

  const handleGroupCheck = (group: TaskGroup) => {
    if (group.type === 'standalone') {
      handleTaskToggle(group.task);
    } else if (!isGroupDone(group)) {
      group.children.forEach(c => { if (!c.done) handleTaskToggle(c); });
    }
  };

  // 출동 체크박스 — 클릭할 때마다 체크/해제 토글
  const toggleDispatch = () => {
    // 체크박스이므로 현장/복귀까지 진행된 뒤에도 다시 누르면 완전히 해제(미응답)됨
    if (isDispatched) updateStatus('미응답');
    else updateStatus('출동중');
  };

  // 다음 임무 버튼 클릭 시 아직 안 된 항목이 있으면 무엇을 체크해야 하는지 알려줌
  const getMissingMessage = (item: StepFlowItem): string | null => {
    const missing: string[] = [];
    if (item.showDispatch && !isDispatched) missing.push('출동체크');
    if (item.group && !isGroupDone(item.group)) missing.push('임무 체크');
    if (item.showReturn && !isReturned) missing.push('복귀완료');
    if (missing.length === 0) return null;
    return `${missing.join(', ')}를 먼저 체크해주세요.`;
  };

  // 이전/다음 임무 — 1단계씩이 아니라 페이지(STEP_PAGE_SIZE) 단위로 이동
  const goPrevPage = () => {
    if (stepIndex <= 0) return;
    const prevStart = stepIndex - STEP_PAGE_SIZE;
    setStepIndex(prevStart <= 0 ? 0 : prevStart);
  };
  const goNextPage = () => {
    if (stepIndex === 0) {
      // 1단계(출동)만 체크해야 다음으로 넘어감
      const msg = getMissingMessage(stepFlow[0]);
      if (msg) { alert(msg); return; }
      setStepIndex(1);
      return;
    }
    // 2단계 이후는 체크 여부와 상관없이 다음 페이지로 이동
    setStepIndex(stepIndex + STEP_PAGE_SIZE);
  };

  // 재난 변경 또는 단계별 진입 시, 현재 진행 상태에 맞는 페이지부터 시작
  useEffect(() => {
    if (viewMode !== 'step') return;
    if (isSituationRoomForStep) { setStepIndex(0); return; }
    if (!isDispatched) { setStepIndex(0); return; }
    const firstUndone = stepFlow.findIndex((it, i) => i >= 1 && !isStepDone(it));
    if (firstUndone === -1) { setStepIndex(stepFlow.length); return; }
    const offset = (firstUndone - 1) % STEP_PAGE_SIZE;
    setStepIndex(Math.max(1, firstUndone - offset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeIncident?.id]);

  // 1단계(출동)의 비상장구 목록 — "비상장구_..." 임무는 몇 번째에 있든 전부 모아서 표시
  const equipmentList = equipmentTasks.flatMap(t => parseEquipmentList(t.label));
  // 여러 개여도 하나의 그룹처럼 묶어 기존 체크 로직(isGroupDone/handleGroupCheck)을 그대로 재사용
  const equipmentGroup: TaskGroup | null =
    equipmentTasks.length === 0 ? null :
    equipmentTasks.length === 1 ? { type: 'standalone', task: equipmentTasks[0] } :
    { type: 'group', header: equipmentTasks[0], children: equipmentTasks.slice(1) };

  // 단계별 임무수행 카드 1개 렌더 — 1단계(출동) 단독 화면과 2단계 이후 페이지 뷰에서 공용으로 사용
  const renderStepCard = (item: StepFlowItem, i: number, isActive: boolean) => {
    const groupHeader = item.group ? (item.group.type === 'standalone' ? item.group.task : item.group.header) : null;
    const rawSplit = groupHeader ? splitRadio(groupHeader.label) : { instruction: '', radio: null };
    // 비상장구 문구는 1단계에 이미 표시되므로, 임무 단계(1단계가 아닌 곳)에서는 중복 제거
    const instruction = item.showDispatch ? rawSplit.instruction : stripEquipmentClause(rawSplit.instruction);
    const radio = rawSplit.radio;
    const hasDetail = !!(item.group && item.group.type === 'group' && item.group.children.length > 0);
    const detailOpen = stepDetailOpen.has(i);

    return (
      <div
        key={i}
        style={{
          display: 'flex', flexDirection: 'column', gap: '12px',
          border: `1px solid ${isActive ? 'rgba(59,130,246,0.4)' : 'rgba(11,37,69,0.09)'}`,
          background: isActive ? 'rgba(59,130,246,0.06)' : 'rgba(11,37,69,0.03)',
          borderRadius: '14px', padding: '16px', flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CheckSquare size={18} color="var(--color-green)" />
          <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
            {i + 1}단계 / {stepFlow.length}단계
          </span>
          {hasDetail && (
            <button
              type="button"
              onClick={() => setStepDetailOpen(prev => {
                const next = new Set(prev);
                next.has(i) ? next.delete(i) : next.add(i);
                return next;
              })}
              style={{
                fontSize: '11px', fontWeight: 700, padding: '5px 9px', borderRadius: '7px',
                background: 'rgba(139,92,246,0.12)', color: '#7c3aed',
                border: '1px solid rgba(139,92,246,0.3)', cursor: 'pointer',
              }}
            >
              세부임무 {detailOpen ? '▲' : '▼'}
            </button>
          )}
        </div>

        {(item.showDispatch || item.showInfo) && (
          <>
            <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#b91c1c', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                🚨 경보내용
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, lineHeight: 1.4 }}>
                {activeIncident!.location}에서 {activeIncident!.disaster} 발생!
              </div>
            </div>
            {equipmentList.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  🎒 비상장구 (탭하면 보관 위치 표시)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {equipmentList.map(eq => (
                    <button
                      key={eq}
                      type="button"
                      onClick={() => setOpenEquipment(prev => prev === eq ? null : eq)}
                      style={{
                        fontSize: '13px', fontWeight: 700, padding: '7px 12px', borderRadius: '20px',
                        background: openEquipment === eq ? 'rgba(96,165,250,0.18)' : 'rgba(11,37,69,0.05)',
                        border: `1px solid ${openEquipment === eq ? 'rgba(96,165,250,0.4)' : 'rgba(11,37,69,0.12)'}`,
                        color: openEquipment === eq ? '#2563eb' : 'var(--text-main)', cursor: 'pointer',
                      }}
                    >
                      {eq}
                    </button>
                  ))}
                </div>
                {openEquipment && equipmentList.includes(openEquipment) && (() => {
                  const found = findEquipmentLocation(activeIncident!.disaster, openEquipment);
                  return (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-muted)', background: 'rgba(11,37,69,0.045)', borderRadius: '10px', padding: '10px 12px' }}>
                      {found ? (
                        <>📍 {openEquipment} 보관위치: <strong style={{ color: 'var(--text-main)' }}>{found.loc}</strong>
                          {found.spec !== '-' && <span> ({found.spec})</span>}
                        </>
                      ) : (
                        <>📍 {openEquipment}: disa_app 비상장비 목록에 이 재난 카테고리로 등록된 위치가 없습니다.</>
                      )}
                    </div>
                  );
                })()}
                {equipmentGroup && (
                  <StepCheckRow
                    checked={isGroupDone(equipmentGroup)}
                    label="비상장구 확인 완료"
                    onClick={() => handleGroupCheck(equipmentGroup)}
                  />
                )}
              </div>
            )}
            {item.showDispatch && (
              <>
                <div style={{ fontSize: '16px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  비상장구를 갖추고 <strong style={{ color: 'var(--text-main)' }}>{activeIncident!.location}</strong>으로 출동하세요!
                </div>
                <StepCheckRow checked={isDispatched} label="출동체크" onClick={toggleDispatch} big />
              </>
            )}
          </>
        )}

        {groupHeader && item.group && (
          <>
            <StepCheckRow
              checked={isGroupDone(item.group)}
              label={instruction}
              onClick={() => handleGroupCheck(item.group!)}
            />
            {hasDetail && detailOpen && item.group.type === 'group' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '14px' }}>
                {item.group.children.map(child => (
                  <div key={child.id} style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    · {stripPrefix(child.label)}
                  </div>
                ))}
              </div>
            )}
            {radio && (
              <div>
                <div style={{
                  fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px',
                }}>
                  📻 무전 예시
                </div>
                <div style={{
                  background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
                  borderRadius: '12px', padding: '13px 15px',
                }}>
                  <div style={{ fontSize: '15px', lineHeight: 1.55, fontStyle: 'italic', color: 'var(--text-main)' }}>
                    &ldquo;{radio}&rdquo;
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {item.showReturn && (
          <>
            <div style={{ fontSize: '17px', fontWeight: 700 }}>
              임무완료하였습니다. 복귀하시고
            </div>
            <StepCheckRow checked={isReturned} label="복귀완료" onClick={() => updateStatus('복귀')} />
          </>
        )}
      </div>
    );
  };

  // 재난 발령/변경 시 전체 그룹 펼침
  useEffect(() => {
    if (!activeIncident) return;
    if (incidentIdRef.current === activeIncident.id) return;
    incidentIdRef.current = activeIncident.id;
    const headers = new Set(
      taskGroups
        .filter((g): g is AccordionGroup => g.type === 'group')
        .map(g => g.header.id)
    );
    setOpenGroups(headers);
  }, [activeIncident?.id, taskGroups]);

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ◇ 헤더는 체크 대상 제외 (진행률 계산)
  const checkableTasks = myTasks.filter(t => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
  const totalTasksCount = checkableTasks.length;
  const completedTasksCount = checkableTasks.filter(t => t.done).length;
  const myProgressPct = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

  const updateStatus = async (status: Responder['status']) => {
    if (!activeIncident) return;
    setOptimisticStatus(status);
    setStatusLoading(true);
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
      setOptimisticStatus(null);
      alert('상태 업데이트 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setStatusLoading(false);
    }
  };

  // 화재 조장 자동 카운트: 같은 배지를 가진 팀원 중 '출동중'인 사람을 '현장'으로 일괄 승격
  const promoteDispatchedTeammates = async (badge: string) => {
    if (!activeIncident) return;
    try {
      const empNos = await db.getEmployeeNosByBadge(activeIncident.disaster, badge, activeIncident.shift ?? 'day');
      const teammates = responders.filter(r =>
        empNos.includes(r.emp_no) && r.emp_no !== currentUser.empNo && r.status === '출동중'
      );
      for (const mate of teammates) {
        await db.setResponderStatus(activeIncident.id, mate.emp_no, mate.name, mate.team, mate.role, '현장');
      }
    } catch (err) {
      console.warn('[조장 자동 카운트] 실패:', err);
    }
  };

  const handleTaskToggle = async (task: MemberTask) => {
    if (task.done) {
      const checker = task.done_by ?? '다른 대원';
      const ok = window.confirm(`${checker}님이 이미 완료했어요.\n해제할까요?`);
      if (!ok) return;
      setOptimisticDone(prev => ({ ...prev, [task.id]: false }));
      try {
        await db.toggleTaskDone(task.id, false, null);
      } catch (err: any) {
        setOptimisticDone(prev => ({ ...prev, [task.id]: true }));
        alert('임무 해제 중 오류가 발생했습니다: ' + err.message);
      }
      return;
    }
    // Optimistic update: 즉시 UI 반영
    setOptimisticDone(prev => ({ ...prev, [task.id]: true }));
    try {
      await db.toggleTaskDone(task.id, true, currentUser.name);
      // 출동체크 후 임무를 하나라도 체크하면 → 자동으로 "현장 임무수행중" 처리 (상황실 제외)
      if (!isSituationRoom && responderStatus === '출동중') {
        updateStatus('현장');
      }
      // 화재: 출동/대응/구조 배지의 조장이 체크하면, 이미 출동체크한 조원도 자동으로 현장 처리
      if (activeIncident?.disaster === '화재' && myBadge && isFireLeaderAutoBadge(myBadge) && currentUser.role.includes('파트장')) {
        promoteDispatchedTeammates(myBadge);
      }
    } catch (err: any) {
      // 실패 시 롤백
      setOptimisticDone(prev => ({ ...prev, [task.id]: false }));
      alert('임무 상태 변경 중 오류가 발생했습니다: ' + err.message);
    }
  };

  // ── 미리보기 임무 변환 ──────────────────────────────────────
  const previewMyRole = previewBadge
    ? (previewRoles.find(r => r.badge === previewBadge) ?? null)
    : null;

  // 상황별 보기: 이 배지 임무에 실제로 붙어있는 variant 값과 개수를 재난대응메뉴얼과 동일하게 집계.
  // variant 임무가 하나도 없으면 빈 배열 — 이 경우 필터 칩 자체를 숨김(항상 '전체'와 동일하므로).
  const previewVariantCounts = useMemo(() => {
    if (!previewMyRole) return { common: 0, variants: [] as { key: string; count: number }[] };
    let common = 0;
    const map: Record<string, number> = {};
    (previewMyRole.disaster_tasks ?? []).forEach(t => {
      if (t.variant) map[t.variant] = (map[t.variant] ?? 0) + 1;
      else common++;
    });
    return { common, variants: Object.entries(map).map(([key, count]) => ({ key, count })) };
  }, [previewMyRole]);

  const previewTasks: MemberTask[] = useMemo(() => {
    if (!previewMyRole) return [];
    return [previewMyRole].flatMap(r =>
      (r.disaster_tasks ?? [])
        .filter(dt =>
          previewVariant === 'ALL' ? true :
          previewVariant === 'COMMON' ? !dt.variant :
          dt.variant === previewVariant
        )
        .sort((a, b) => a.task_idx - b.task_idx)
        .map(dt => ({
          id: `preview_${dt.id}`,
          incident_id: 'preview',
          emp_no: currentUser.empNo,
          role: r.role,
          task_idx: dt.task_idx,
          label: dt.label,
          done: previewLocalDone[`preview_${dt.id}`] ?? false,
          done_by: null,
          updated_at: null,
        } satisfies MemberTask))
    );
  }, [previewMyRole, previewRoles, previewBadge, previewVariant, previewLocalDone, currentUser.empNo]);

  const previewTaskGroups = useMemo(() => groupTasks(previewTasks), [previewTasks]);
  const previewTaskNumMap = useMemo(() => computeTaskNumMap(previewTasks), [previewTasks]);
  const previewCheckable = previewTasks.filter(t => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
  const previewDoneCount = previewCheckable.filter(t => t.done).length;
  const previewPct = previewCheckable.length > 0 ? Math.round((previewDoneCount / previewCheckable.length) * 100) : 0;

  const togglePreviewGroup = (id: string) => {
    setPreviewOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handlePreviewToggle = (task: MemberTask) => {
    setPreviewLocalDone(prev => ({ ...prev, [task.id]: !task.done }));
  };

  const displayTeam = currentUser.team
    .replace('파트장', '파트')
    .replace(/^보안[123]$/, '보안파트');

  const isSituationRoom = myBadge === '상황';
  const roleColor = isSituationRoom ? '#facc15' : (myRole?.bc ?? undefined);

  // 화재 감지기동작 시 초기출동조 여부 판단
  const isFireInitial = activeIncident?.disaster === '화재' && activeIncident?.scope === 'fire_initial';
  const isWaitingForEscalation = isFireInitial && myBadge !== null && !FIRE_INITIAL_BADGES.has(myBadge ?? '');

  return (
    <div className="content">
      {!activeIncident ? (
        <>
          {/* 비상 대기 카드 */}
          <div className="card" style={{ textAlign: 'center', padding: '28px 20px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 12px auto', border: '2px solid rgba(16, 185, 129, 0.2)'
            }}>
              <span style={{ fontSize: '22px' }}>🟢</span>
            </div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '16px', marginBottom: '6px' }}>
              비상 대기 중
            </h3>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
              borderRadius: '20px', padding: '4px 14px', marginBottom: '10px'
            }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#2563eb' }}>
                {displayTeam} · {currentUser.name}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({currentUser.role})</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: 1.5, marginBottom: '14px' }}>
              현재 발령된 비상 상황이 없습니다.<br />
              재난 유형을 선택하면 나의 임무를 미리 볼 수 있습니다.
            </p>
            {/* iOS만 표시 */}
            {/iPad|iPhone|iPod/.test(navigator.userAgent) && (
              <button
                onClick={() => {
                  unlockAudio();
                  if ('speechSynthesis' in window) {
                    speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance('재난 알람 및 대원 음성 방송 권한이 활성화되었습니다.');
                    const voices = speechSynthesis.getVoices();
                    const userSelectedName = localStorage.getItem('tt_selected_voice') || '';
                    const v = voices.find(voice => voice.name === userSelectedName);
                    if (v) { u.voice = v; u.lang = v.lang; }
                    else { u.lang = 'ko-KR'; }
                    u.rate = 0.95;
                    speechSynthesis.speak(u);
                  }
                  alert('음성 알람 및 사이렌 재생 권한이 활성화되었습니다.');
                }}
                className="btn"
                style={{
                  width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '8px',
                  background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#059669', padding: '8px 16px', borderRadius: '10px',
                  fontWeight: 700, fontSize: '13px', cursor: 'pointer'
                }}
              >
                🔊 음성 알람 권한 활성화 (iOS 필수)
              </button>
            )}
          </div>

          {/* 재난 유형 선택 */}
          <div className="card" style={{ padding: '14px 16px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700, display: 'block', marginBottom: '10px' }}>
              📋 재난 유형 선택 — 나의 임무 미리보기
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {DISASTERS.map(d => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setPreviewDisaster(prev => prev === d.key ? null : d.key)}
                  style={{
                    padding: '7px 14px', borderRadius: '20px', cursor: 'pointer',
                    fontSize: '13px', fontWeight: 700, border: '1.5px solid',
                    background: previewDisaster === d.key ? d.color : 'rgba(11,37,69,0.045)',
                    borderColor: previewDisaster === d.key ? d.color : 'rgba(11,37,69,0.18)',
                    color: previewDisaster === d.key ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* 미리보기 임무 */}
          {previewDisaster && (
            previewLoading ? (
              <div className="card" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
                불러오는 중...
              </div>
            ) : !previewMyRole ? (
              <div className="card" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
                {(() => {
                  const d = DISASTERS.find(x => x.key === previewDisaster);
                  return `${d?.label ?? previewDisaster} 재난에 배정된 임무가 없습니다.`;
                })()}
              </div>
            ) : (
              <>
                {/* 미리보기 배너 */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                  borderRadius: '10px', padding: '10px 14px', fontSize: '12px', color: '#6d28d9',
                }}>
                  <span style={{ fontSize: '15px' }}>👁️</span>
                  <span>
                    <strong style={{ color: '#7c3aed' }}>미리보기 모드</strong> — 발령 전 임무 확인용입니다.
                    체크는 로컬에만 저장되며 실제 임무와 무관합니다.
                  </span>
                </div>

                {/* 배지·역할 카드 */}
                <div className="card" style={{ borderColor: 'rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <Award size={20} color={previewMyRole.bc ?? '#7c3aed'} />
                    <h3 style={{ margin: 0, fontSize: '15px', flex: 1 }}>
                      나의 임무 카드:{' '}
                      <span style={{ color: previewMyRole.bc ?? '#7c3aed' }}>{previewMyRole.role}</span>
                    </h3>
                    <span style={{
                      background: previewMyRole.bc ?? '#7c3aed', color: '#fff',
                      fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '12px'
                    }}>
                      {previewBadge}
                    </span>
                  </div>
                  <div className="progress-container">
                    <div className="progress-header">
                      <span>자가 수행률 (미리보기)</span>
                      <strong style={{ color: previewPct === 100 ? 'var(--color-green)' : '#7c3aed' }}>
                        {previewPct}% {previewPct === 100 && '✓'}
                      </strong>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${previewPct}%`, backgroundColor: previewPct === 100 ? 'var(--color-green)' : (previewMyRole.bc ?? '#7c3aed') }}
                      />
                    </div>
                  </div>
                </div>

                {/* 체크리스트 */}
                <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', borderColor: 'rgba(139,92,246,0.2)' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '14px 16px', borderBottom: '1px solid rgba(11,37,69,0.06)'
                  }}>
                    <CheckSquare size={18} color="#7c3aed" />
                    <h3 style={{ margin: 0, fontSize: '14px', flex: 1 }}>행동 매뉴얼 — {(() => { const d = DISASTERS.find(x => x.key === previewDisaster); return d?.label ?? previewDisaster; })()}</h3>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: previewDoneCount === previewCheckable.length && previewCheckable.length > 0 ? '#059669' : 'var(--text-muted)' }}>
                      {previewDoneCount} / {previewCheckable.length}
                    </span>
                  </div>
                  {/* 상황별 보기 — 이 배지에 variant 임무가 하나라도 있을 때만 표시. 미리보기 전용(발령 후에는 안 씀) */}
                  {previewVariantCounts.variants.length > 0 && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
                      padding: '10px 16px', borderBottom: '1px solid rgba(11,37,69,0.06)',
                      background: 'rgba(139,92,246,0.04)',
                    }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#7c3aed', flexShrink: 0 }}>🏷️ 상황별 보기:</span>
                      {([
                        { key: 'ALL' as const, label: '전체', count: previewVariantCounts.common + previewVariantCounts.variants.reduce((s, v) => s + v.count, 0) },
                        { key: 'COMMON' as const, label: '공통', count: previewVariantCounts.common },
                        ...previewVariantCounts.variants.map(v => ({ key: v.key, label: VARIANT_LABELS[v.key] ?? v.key, count: v.count })),
                      ]).map(({ key, label, count }) => {
                        const active = previewVariant === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setPreviewVariant(key)}
                            style={{
                              padding: '5px 10px', borderRadius: '999px', cursor: 'pointer',
                              fontSize: '11.5px', fontWeight: 700, whiteSpace: 'nowrap',
                              background: active ? 'rgba(124,58,237,0.2)' : 'rgba(11,37,69,0.05)',
                              border: `1px solid ${active ? 'rgba(124,58,237,0.55)' : 'rgba(11,37,69,0.12)'}`,
                              color: active ? '#7c3aed' : 'var(--text-muted)',
                            }}
                          >
                            {label} {count}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 16px' }}>
                    <TaskChecklistBody
                      groups={previewTaskGroups}
                      numMap={previewTaskNumMap}
                      openGroups={previewOpenGroups}
                      onToggleGroup={togglePreviewGroup}
                      onToggleTask={handlePreviewToggle}
                      theme={{
                        headerBg: 'rgba(139,92,246,0.1)', headerBorder: 'rgba(139,92,246,0.2)',
                        chevronColor: '#7c3aed', labelColor: '#6d28d9', bodyBorder: 'rgba(139,92,246,0.15)',
                      }}
                    />
                  </div>
                </div>
              </>
            )
          )}
        </>
      ) : (
        <>
          {/* Active Incident Banner */}
          <div className="banner alarm-active" style={{
            background: activeIncident.mode.startsWith('실제')
              ? 'linear-gradient(135deg, rgba(239,68,68,0.2) 0%, rgba(220,38,38,0.3) 100%)'
              : 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(217,119,6,0.25) 100%)',
            borderColor: activeIncident.mode.startsWith('실제') ? 'var(--color-fire)' : 'var(--color-power)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <div className="banner-title" style={{ color: activeIncident.mode.startsWith('실제') ? 'var(--color-fire)' : 'var(--color-power)', minWidth: 0, overflow: 'hidden' }}>
                <ShieldAlert size={18} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {activeIncident.mode.startsWith('실제') ? '🚨 실제 비상 상황' : '🎓 대응 훈련'}
                  {isFireInitial && <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.8 }}>· 감지기동작</span>}
                </span>
              </div>
              <span style={{ fontSize: '11px', background: 'rgba(11,37,69,0.12)', padding: '2px 8px', borderRadius: '6px', flexShrink: 0 }}>
                {activeIncident.disaster}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', marginTop: '10px', color: 'var(--text-main)' }}>
              <MapPin size={16} color="var(--text-muted)" />
              <span>위치: <strong>{activeIncident.location}</strong></span>
            </div>
          </div>

          {/* 화재 감지기동작: 초기출동조 외 대원 대기 안내 */}
          {isWaitingForEscalation && (
            <div className="card" style={{ textAlign: 'center', padding: '32px 20px', borderColor: 'rgba(245,158,11,0.3)' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>⏳</div>
              <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '8px', color: '#b45309' }}>
                대기 중
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                현재 <strong style={{ color: '#b45309' }}>감지기동작 단계</strong>입니다.<br />
                초기출동조가 현장을 확인 중입니다.<br />
                지휘관이 승격하면 임무가 부여됩니다.
              </div>
            </div>
          )}

          {/* 대원 신원 카드 — 아바타 · 이름 · 파트/역할 · 배지 */}
          {myRole && (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px' }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: 800, color: '#fff',
              }}>
                {currentUser.name.slice(-2)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', fontWeight: 800 }}>{currentUser.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayTeam} · {myRole.role}
                </div>
              </div>
              {myBadge && (
                <span style={{
                  fontSize: '11.5px', fontWeight: 800, padding: '5px 10px', borderRadius: '8px', flexShrink: 0,
                  background: 'rgba(96,165,250,0.12)', color: '#2563eb', border: '1px solid rgba(96,165,250,0.3)',
                }}>
                  배지: {myBadge}
                </span>
              )}
            </div>
          )}

          {/* 보기 방식 전환 — 상황실은 출동/현장 개념이 없어 숨김. 단계별을 누르면 전체화면으로 전환 */}
          {!isSituationRoom && myRole && (
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-btn ${viewMode === 'step' ? 'active' : ''}`}
                onClick={() => setViewMode('step')}
              >
                ① 단계별 임무수행
              </button>
              <button
                type="button"
                className={`segmented-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                ② 전체목록(현행)
              </button>
            </div>
          )}

          {/* Responder Status - 상황실은 숨김, 단계별 보기에서는 단계 안에 포함됨 */}
          {!isSituationRoom && viewMode === 'list' && (
            <div className="card">
              <label>나의 대응 상태</label>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                {(['출동중', '현장', '복귀'] as const).map((s) => {
                  const colors: Record<string, string> = { '출동중': 'var(--color-power)', '현장': 'var(--color-water)', '복귀': 'var(--color-green)' };
                  const labels: Record<string, string> = { '출동중': '🚨 출동중', '현장': '📍 도착', '복귀': '✅ 복귀' };
                  return (
                    <button
                      key={s}
                      type="button"
                      className="btn"
                      style={{
                        flex: 1, padding: '10px 4px', fontSize: '12px',
                        background: responderStatus === s ? colors[s] : 'rgba(11,37,69,0.05)',
                        border: responderStatus === s ? 'none' : '1px solid rgba(11,37,69,0.12)',
                        color: responderStatus === s ? '#ffffff' : '#2563eb',
                      }}
                      onClick={() => {
                        // 훈련 상황에서는 같은 버튼을 다시 누르면 해제(미응답)됨
                        const isTraining = activeIncident.mode.startsWith('훈련');
                        if (isTraining && responderStatus === s) updateStatus('미응답');
                        else updateStatus(s);
                      }}
                      disabled={statusLoading}
                    >
                      {labels[s]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {myRole ? (
            <>
              {/* Progress Card */}
              <div className="card" style={isSituationRoom ? { borderColor: 'rgba(250,204,21,0.4)', background: 'rgba(250,204,21,0.05)' } : {}}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Award size={20} color={roleColor ?? 'var(--color-power)'} />
                  <h3 style={{ margin: 0, fontSize: '15px', flex: 1 }}>
                    나의 임무 카드: <span style={{ color: roleColor }}>{myRole.role}</span>
                  </h3>
                  <span style={{ fontSize: '12px', color: isSituationRoom ? '#facc15' : 'var(--text-muted)', fontWeight: 700 }}>
                    나({currentUser.name})
                  </span>
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
                        backgroundColor: myProgressPct === 100 ? 'var(--color-green)' : (roleColor || 'var(--color-fire)')
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Task Checklist – 전체 아코디언 */}
              {viewMode === 'list' && (
              <div className="card" style={{ flex: showChecklist ? 1 : '0 0 auto', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                {/* 헤더 — 탭으로 접기/펼치기 */}
                <div
                  className="accordion-header"
                  onClick={() => setShowChecklist(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '14px 16px',
                    borderBottom: showChecklist ? '1px solid rgba(11,37,69,0.06)' : 'none',
                  }}
                >
                  <CheckSquare size={18} color="var(--color-green)" />
                  <h3 style={{ margin: 0, fontSize: '14px', flex: 1 }}>
                    행동 매뉴얼 체크리스트
                  </h3>
                  <span style={{
                    fontSize: '12px', fontWeight: 700,
                    color: completedTasksCount === totalTasksCount && totalTasksCount > 0 ? '#059669' : 'var(--text-muted)',
                  }}>
                    {completedTasksCount} / {totalTasksCount}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                    {showChecklist ? '▲' : '▼'}
                  </span>
                </div>

                {showChecklist && (
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 16px' }}>
                  <TaskChecklistBody
                    groups={taskGroups}
                    numMap={taskNumMap}
                    openGroups={openGroups}
                    onToggleGroup={toggleGroup}
                    onToggleTask={handleTaskToggle}
                    theme={{
                      headerBg: 'rgba(59,130,246,0.12)', headerBorder: 'rgba(59,130,246,0.25)',
                      chevronColor: '#2563eb', labelColor: '#1d4ed8', bodyBorder: 'rgba(59,130,246,0.15)',
                    }}
                  />
                </div>
                )}
              </div>
              )}

              {/* 단계별 임무수행 — 체크박스 중심, 전체화면으로 표시 */}
              {viewMode === 'step' && (
                <div style={{
                  position: 'fixed', inset: 0, zIndex: 300,
                  background: 'var(--bg-app)',
                  display: 'flex', flexDirection: 'column',
                  paddingTop: 'env(safe-area-inset-top, 0px)',
                  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}>
                  {/* 전체화면 상단 바 */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px',
                    borderBottom: '1px solid rgba(11,37,69,0.09)', flexShrink: 0,
                  }}>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      style={{
                        background: 'rgba(11,37,69,0.06)', border: '1px solid rgba(11,37,69,0.12)',
                        color: 'var(--text-muted)', borderRadius: '10px', padding: '8px 12px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 700,
                      }}
                    >
                      <ChevronLeft size={16} /> 전체목록
                    </button>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                      <div style={{ fontSize: '13px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {activeIncident.disaster} · {currentUser.name}
                      </div>
                    </div>
                    <div style={{ width: '84px', flexShrink: 0 }} />
                  </div>

                  <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '18px', padding: '22px 20px', margin: '12px 16px', borderRadius: '18px' }}>
                  {/* 임무 카드 수행률 — 전체목록과 동일한 값(myProgressPct)을 그대로 표시해 두 보기 간 진행률 불일치 방지 */}
                  <div className="progress-container" style={{ flexShrink: 0 }}>
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
                          backgroundColor: myProgressPct === 100 ? 'var(--color-green)' : (roleColor || 'var(--color-fire)')
                        }}
                      />
                    </div>
                  </div>
                  {/* 진행 칩 */}
                  <div style={{ display: 'flex', gap: '7px', overflowX: 'auto', paddingBottom: '2px', flexShrink: 0 }}>
                    {stepFlow.map((item, i) => {
                      const done = isStepDone(item);
                      const isCurrent = stepIndex === 0 ? i === 0 : (i >= stepIndex && i < stepIndex + STEP_PAGE_SIZE);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setStepIndex(i)}
                          style={{
                            flexShrink: 0, width: '38px', height: '38px', borderRadius: '11px',
                            fontSize: '13px', fontWeight: 800, border: '1px solid', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: done ? 'rgba(16,185,129,0.16)' : isCurrent ? 'rgba(59,130,246,0.16)' : 'rgba(11,37,69,0.05)',
                            borderColor: done ? 'rgba(16,185,129,0.35)' : isCurrent ? 'rgba(59,130,246,0.4)' : 'rgba(11,37,69,0.12)',
                            color: done ? '#059669' : isCurrent ? '#2563eb' : 'var(--text-muted)',
                          }}
                        >
                          {done ? <Check size={16} strokeWidth={3} /> : (i + 1)}
                        </button>
                      );
                    })}
                  </div>

                  {/* 1단계(출동)는 단독 전체화면, 2단계부터는 3개씩 페이지로 보여줌 */}
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
                  {stepIndex >= stepFlow.length ? (
                    stepFlow.every(isStepDone) ? (
                      <div style={{ textAlign: 'center', padding: '20px 8px', margin: 'auto 0' }}>
                        <div style={{ fontSize: '52px', marginBottom: '14px' }}>🎉</div>
                        <div style={{ fontWeight: 800, fontSize: '22px', marginBottom: '8px' }}>모든 임무를 완료했습니다</div>
                        <div style={{ fontSize: '15px', color: 'var(--text-muted)' }}>수고하셨습니다.</div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '20px 8px', margin: 'auto 0' }}>
                        <div style={{ fontSize: '52px', marginBottom: '14px' }}>⚠️</div>
                        <div style={{ fontWeight: 800, fontSize: '22px', marginBottom: '8px' }}>아직 완료하지 않은 임무가 있습니다</div>
                        <div style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                          체크하지 않고 넘어간 단계가 있어요. 처음부터 다시 확인해주세요.
                        </div>
                        <button
                          type="button" className="btn btn-primary" style={{ padding: '13px 24px', fontSize: '15px' }}
                          onClick={() => setStepIndex(0)}
                        >
                          처음부터 확인하기
                        </button>
                      </div>
                    )
                  ) : stepIndex === 0 ? (
                    <>
                      {renderStepCard(stepFlow[0], 0, true)}
                      <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                        <button
                          type="button" className="btn btn-primary" style={{ flex: 1, padding: '17px', fontSize: '17px' }}
                          disabled={statusLoading}
                          onClick={goNextPage}
                        >
                          다음 임무 <ChevronRight size={20} />
                        </button>
                      </div>
                    </>
                  ) : (() => {
                    const pageEnd = Math.min(stepIndex + STEP_PAGE_SIZE, stepFlow.length);
                    const pageIndices = Array.from({ length: pageEnd - stepIndex }, (_, k) => stepIndex + k);
                    const isLastPage = pageEnd >= stepFlow.length;

                    return (
                      <>
                        {pageIndices.map(i => renderStepCard(stepFlow[i], i, true))}

                        {/* 공용 이전/다음 네비게이션 — 1단계씩이 아니라 페이지(3단계) 단위로 이동 */}
                        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                          <button
                            type="button" className="btn btn-secondary" style={{ width: 'auto', padding: '17px 20px', fontSize: '16px' }}
                            onClick={goPrevPage}
                          >
                            <ChevronLeft size={20} /> 이전임무
                          </button>
                          <button
                            type="button" className="btn btn-primary" style={{ flex: 1, padding: '17px', fontSize: '17px' }}
                            disabled={statusLoading}
                            onClick={goNextPage}
                          >
                            {isLastPage ? '임무 완료' : (<>다음 임무 <ChevronRight size={20} /></>)}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                  </div>
                  </div>
                </div>
              )}
            </>
          ) : (
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
