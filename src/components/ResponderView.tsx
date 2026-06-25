import React, { useEffect, useRef, useState, useMemo } from 'react';
import { type Incident, type Responder, type MemberTask, type DisasterRole, db } from '../services/supabase';
import { type Employee } from './Login';
import { Check, ShieldAlert, MapPin, Award, CheckSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { unlockAudio } from '../utils/audio';

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
  const incidentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeIncident) { setMyBadge(null); return; }
    db.getEmployeeBadge(currentUser.empNo, activeIncident.disaster)
      .then(badge => setMyBadge(badge))
      .catch(() => setMyBadge(null));
  }, [activeIncident?.id, currentUser.empNo]);

  const currentResponder = responders.find(r => r.emp_no === currentUser.empNo);
  const responderStatus = optimisticStatus ?? (currentResponder ? currentResponder.status : '미응답');

  // Realtime 응답 오면 optimistic 상태 정리
  useEffect(() => {
    if (currentResponder && optimisticStatus === currentResponder.status) {
      setOptimisticStatus(null);
    }
  }, [currentResponder?.status]);

  const myRole = myBadge
    ? (disasterRoles.find(r => r.badge === myBadge) ?? null)
    : null;

  const rawTasks = myRole ? tasks.filter(t => t.role === myRole.role) : [];

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
    } catch (err: any) {
      // 실패 시 롤백
      setOptimisticDone(prev => ({ ...prev, [task.id]: false }));
      alert('임무 상태 변경 중 오류가 발생했습니다: ' + err.message);
    }
  };

  const displayTeam = currentUser.team
    .replace('파트장', '파트')
    .replace(/^보안[123]$/, '보안파트');

  const isSituationRoom = myBadge === '상황실';
  const roleColor = isSituationRoom ? '#facc15' : (myRole?.bc ?? undefined);

  // 화재 감지기동작 시 초기출동조 여부 판단
  const FIRE_INITIAL_BADGES = new Set(['총괄', '상황실', '통제', '출동']);
  const isFireInitial = activeIncident?.disaster === '화재' && activeIncident?.scope === 'fire_initial';
  const isWaitingForEscalation = isFireInitial && myBadge !== null && !FIRE_INITIAL_BADGES.has(myBadge ?? '');

  return (
    <div className="content">
      {!activeIncident ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px auto', border: '2px solid rgba(16, 185, 129, 0.2)'
          }}>
            <span style={{ fontSize: '24px' }}>🟢</span>
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', marginBottom: '6px' }}>
            비상 대기 중
          </h3>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: '20px', padding: '4px 14px', marginBottom: '14px'
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#60a5fa' }}>
              {displayTeam} · {currentUser.name}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({currentUser.role})</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            현재 발령된 비상 상황이 없습니다.<br />
            재난 수신기가 감지되거나 지휘자가 발령하면 여기에 알람이 표시됩니다.
          </p>
          {/* iOS만 표시 — Android/데스크탑은 자동 활성화됨 */}
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
                marginTop: '12px', width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '8px',
                background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#34d399', padding: '10px 18px', borderRadius: '10px',
                fontWeight: 700, fontSize: '13px', cursor: 'pointer'
              }}
            >
              🔊 음성 알람 권한 활성화 (iOS 필수)
            </button>
          )}
        </div>
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
              <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '6px', flexShrink: 0 }}>
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
              <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '8px', color: '#fbbf24' }}>
                대기 중
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                현재 <strong style={{ color: '#fbbf24' }}>감지기동작 단계</strong>입니다.<br />
                초기출동조가 현장을 확인 중입니다.<br />
                지휘관이 승격하면 임무가 부여됩니다.
              </div>
            </div>
          )}

          {/* Responder Status - 상황실은 숨김 */}
          {!isSituationRoom && (
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
                        background: responderStatus === s ? colors[s] : 'rgba(255,255,255,0.05)',
                        border: responderStatus === s ? 'none' : '1px solid rgba(255,255,255,0.1)'
                      }}
                      onClick={() => updateStatus(s)}
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
              <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                {/* 헤더 — 탭으로 접기/펼치기 */}
                <div
                  className="accordion-header"
                  onClick={() => setShowChecklist(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '14px 16px',
                    borderBottom: showChecklist ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  }}
                >
                  <CheckSquare size={18} color="var(--color-green)" />
                  <h3 style={{ margin: 0, fontSize: '14px', flex: 1 }}>
                    행동 매뉴얼 체크리스트
                  </h3>
                  <span style={{
                    fontSize: '12px', fontWeight: 700,
                    color: completedTasksCount === totalTasksCount && totalTasksCount > 0 ? '#34d399' : 'var(--text-muted)',
                  }}>
                    {completedTasksCount} / {totalTasksCount}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                    {showChecklist ? '▲' : '▼'}
                  </span>
                </div>

                {showChecklist && (
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 16px' }}>
                  {taskGroups.map((group, gi) => {
                    if (group.type === 'standalone') {
                      const task = group.task;
                      const num = taskNumMap[task.id] ?? String(gi + 1).padStart(2, '0');
                      return (
                        <div
                          key={task.id}
                          className={`task-item ${task.done ? 'done' : ''}`}
                          onClick={() => handleTaskToggle(task)}
                        >
                          <div className="checkbox-visual">
                            <Check size={14} strokeWidth={3} />
                          </div>
                          <div className="task-label">
                            <span style={{ color: 'var(--text-muted)', fontWeight: 700, marginRight: '4px', fontSize: '11px' }}>TASK {num}</span>
                            {stripPrefix(task.label)}
                          </div>
                        </div>
                      );
                    }

                    // Accordion group
                    const isOpen = openGroups.has(group.header.id);
                    const doneCount = group.children.filter(c => c.done).length;
                    const total = group.children.length;
                    const headerNum = taskNumMap[group.header.id] ?? String(gi + 1).padStart(2, '0');

                    return (
                      <div key={group.header.id}>
                        {/* 그룹 헤더 바 (◇) */}
                        <div
                          onClick={() => toggleGroup(group.header.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '11px 14px',
                            background: 'rgba(59,130,246,0.12)',
                            border: '1px solid rgba(59,130,246,0.25)',
                            borderRadius: isOpen ? '10px 10px 0 0' : '10px',
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                            {isOpen
                              ? <ChevronDown size={15} color="#60a5fa" style={{ flexShrink: 0 }} />
                              : <ChevronRight size={15} color="#60a5fa" style={{ flexShrink: 0 }} />
                            }
                            <span style={{
                              fontSize: '13px', fontWeight: 700, color: '#93c5fd',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                            }}>
                              <span style={{ color: '#60a5fa', fontWeight: 700, marginRight: '4px', fontSize: '11px' }}>TASK {headerNum}</span>
                              {stripPrefix(group.header.label)}
                            </span>
                          </div>
                          <span style={{
                            fontSize: '11px', fontWeight: 700, flexShrink: 0, marginLeft: '8px',
                            color: doneCount === total && total > 0 ? '#34d399' : '#64748b'
                          }}>
                            {doneCount}/{total}
                          </span>
                        </div>

                        {/* 서브 항목 (┖) */}
                        {isOpen && (
                          <div style={{
                            border: '1px solid rgba(59,130,246,0.15)',
                            borderTop: 'none',
                            borderRadius: '0 0 10px 10px',
                            overflow: 'hidden',
                            marginBottom: gi < taskGroups.length - 1 ? '2px' : '0',
                          }}>
                            {group.children.map((child, ci) => {
                              const childNum = taskNumMap[child.id] ?? `${gi + 1}-${ci + 1}`;
                              return (
                                <div
                                  key={child.id}
                                  className={`task-item ${child.done ? 'done' : ''}`}
                                  onClick={() => handleTaskToggle(child)}
                                  style={{
                                    borderRadius: 0,
                                    borderBottom: ci < group.children.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                    paddingLeft: '20px',
                                    marginBottom: 0,
                                  }}
                                >
                                  <div className="checkbox-visual">
                                    <Check size={14} strokeWidth={3} />
                                  </div>
                                  <div className="task-label">
                                    <span style={{ color: 'var(--text-muted)', fontWeight: 700, marginRight: '4px', fontSize: '11px' }}>TASK {childNum}</span>
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
                </div>
                )}
              </div>
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
