import React, { useState } from 'react';
import { db, type EmployeeDB, type Incident, type Responder, type MemberTask } from '../services/supabase';
import { History, X, ChevronDown } from 'lucide-react';

interface IncidentHistoryPanelProps {
  employees: EmployeeDB[];
}

// 지휘본부 "신규 비상 상황 발령" 화면에 있던 종료 재난 기록 열람 기능을 조직관리(기타관리)로
// 이전함(2026-07-29) — 발령 화면은 발령 자체에만 집중하도록 정리.
export const IncidentHistoryPanel: React.FC<IncidentHistoryPanelProps> = ({ employees }) => {
  const [showLog, setShowLog] = useState(false);
  const [logIncidents, setLogIncidents] = useState<Incident[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logDetail, setLogDetail] = useState<{
    responders: Responder[];
    tasks: MemberTask[];
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

  const downloadReport = (inc: Incident) => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <button type="button" onClick={loadLog} disabled={logLoading}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '10px 14px', borderRadius: '10px', cursor: logLoading ? 'default' : 'pointer',
          border: '1px solid rgba(148,163,184,0.2)',
          background: 'rgba(148,163,184,0.04)',
          color: '#64748b', fontSize: '13px', fontWeight: 700,
        }}>
        <History size={15} />
        {logLoading ? '로딩 중...' : '종료 재난 기록 보기'}
      </button>

      {showLog && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid rgba(11,37,69,0.06)' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
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
                <div key={inc.id} style={{ borderBottom: '1px solid rgba(11,37,69,0.045)' }}>
                  <div onClick={() => loadLogDetail(inc.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 14px', cursor: 'pointer', background: isExpanded ? 'rgba(11,37,69,0.045)' : 'transparent' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>{inc.disaster} — {inc.location}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{inc.mode} · {fmtDate(inc.declared_at)}</div>
                    </div>
                    <ChevronDown size={14} color="#475569" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '10px 14px 14px', background: 'rgba(11,37,69,0.03)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {logDetailLoading ? (
                        <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', padding: '12px' }}>로딩 중...</div>
                      ) : logDetail ? (() => {

                        const checkable = logDetail.tasks.filter(t => !t.label.startsWith('◇') && !t.label.startsWith('◆'));
                        const doneTasks = checkable.filter(t => t.done);
                        const pct = checkable.length > 0 ? Math.round(doneTasks.length / checkable.length * 100) : 0;

                        const roleGroups: Record<string, typeof logDetail.tasks> = {};
                        for (const t of checkable) { (roleGroups[t.role] ??= []).push(t); }

                        const getEmpName = (empNo: string | null | undefined) =>
                          employees.find(e => e.emp_no === empNo)?.name ?? (empNo || '—');

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
                                  <div key={lbl} style={{ background: 'rgba(11,37,69,0.045)', borderRadius: '6px', padding: '5px 8px' }}>
                                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 700, marginBottom: '2px' }}>{lbl}</div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-main)', fontWeight: 600, wordBreak: 'break-all' }}>{val}</div>
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
                                color: '#4f46e5',
                              }}>📄 보고서 다운로드</button>
                            </div>

                            {/* ② 출동 현황 아코디언 */}
                            <div style={{ border: '1px solid rgba(11,37,69,0.09)', borderRadius: '7px', overflow: 'hidden' }}>
                              <div onClick={() => toggleSub(inc.id, 'responders')} style={{
                                display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', cursor: 'pointer',
                                background: 'rgba(11,37,69,0.045)',
                                borderBottom: isSubOpen(inc.id, 'responders') ? '1px solid rgba(11,37,69,0.07)' : 'none',
                              }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', flex: 1 }}>
                                  👥 출동 현황 ({logDetail.responders.length}명)
                                </span>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' as const }}>
                                  {(['현장', '복귀', '출동중', '미응답'] as const).map(st => {
                                    const cnt = logDetail!.responders.filter(r => r.status === st).length;
                                    if (cnt === 0) return null;
                                    const c = st==='출동중'?'#c2410c':st==='현장'?'#0284c7':st==='복귀'?'#16a34a':'#64748b';
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
                                      const c = r.status==='출동중'?'#c2410c':r.status==='현장'?'#0284c7':r.status==='복귀'?'#16a34a':'#64748b';
                                      return (
                                        <div key={r.emp_no} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', borderRadius: '5px', background: 'rgba(11,37,69,0.035)' }}>
                                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c, flexShrink: 0 }} />
                                          <span style={{ fontSize: '12px', color: 'var(--text-main)', flex: 1 }}>{r.name}</span>
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
                            <div style={{ border: '1px solid rgba(11,37,69,0.09)', borderRadius: '7px', overflow: 'hidden' }}>
                              <div onClick={() => toggleSub(inc.id, 'tasks')} style={{
                                display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', cursor: 'pointer',
                                background: 'rgba(11,37,69,0.045)',
                                borderBottom: isSubOpen(inc.id, 'tasks') ? '1px solid rgba(11,37,69,0.07)' : 'none',
                              }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', flex: 1 }}>
                                  ✅ 임무 수행 내역
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <div style={{ width: '60px', height: '4px', borderRadius: '2px', background: 'rgba(11,37,69,0.06)' }}>
                                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px', background: '#0f9d63' }} />
                                  </div>
                                  <span style={{ fontSize: '10px', color: '#0f9d63', fontWeight: 700, whiteSpace: 'nowrap' as const }}>{pct}% ({doneTasks.length}/{checkable.length})</span>
                                </div>
                                <ChevronDown size={13} color="#475569" style={{ transform: isSubOpen(inc.id, 'tasks') ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                              </div>
                              {isSubOpen(inc.id, 'tasks') && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '8px' }}>
                                  {Object.entries(roleGroups).map(([role, roleTasks]) => {
                                    const doneInRole = roleTasks.filter(t => t.done).length;
                                    return (
                                      <div key={role}>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, padding: '3px 0', borderBottom: '1px solid rgba(11,37,69,0.06)', marginBottom: '4px' }}>
                                          {role} ({doneInRole}/{roleTasks.length})
                                        </div>
                                        {[...roleTasks].sort((a, b) => a.task_idx - b.task_idx).map(t => (
                                          <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '3px 2px', opacity: t.done ? 1 : 0.4 }}>
                                            <span style={{ fontSize: '11px', marginTop: '1px', flexShrink: 0 }}>{t.done ? '✅' : '⬜'}</span>
                                            <span style={{ fontSize: '12px', color: t.done ? 'var(--text-main)' : '#64748b', flex: 1 }}>{t.label}</span>
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
    </div>
  );
};
