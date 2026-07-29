import React, { useEffect, useRef, useState } from 'react';
import { supabase, db, type IncidentFeedEntry } from '../services/supabase';
import { Camera, Send, X, Radio } from 'lucide-react';

interface IncidentFeedPanelProps {
  incidentId: string;
  empNo: string;
  name: string;
  team: string;
  badge: string | null;
  readOnly?: boolean; // 종료된 재난 기록 열람용 — 프리셋/입력창 없이 읽기만
}

const PRESETS = ['📍 현장 도착', '✅ 완료', '🆘 지원 요청', '👌 이상 없음'];

const AVATAR_COLORS = ['#dc2626', '#d9820a', '#2563eb', '#0f9d63', '#6d5bd0'];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB

export const IncidentFeedPanel: React.FC<IncidentFeedPanelProps> = ({ incidentId, empNo, name, team, badge, readOnly = false }) => {
  const [entries, setEntries] = useState<IncidentFeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ file: File; url: string; kind: 'photo' | 'video' } | null>(null);
  const [caption, setCaption] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    db.getIncidentFeed(incidentId)
      .then(rows => { if (!cancelled) setEntries(rows); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    // 종료된 재난 기록 열람 시에는 새 글이 올라올 일이 없으므로 구독 생략
    if (readOnly) return () => { cancelled = true; };

    const channel = supabase
      .channel(`incident-feed-${incidentId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'incident_feed', filter: `incident_id=eq.${incidentId}` },
        (payload) => {
          const row = payload.new as IncidentFeedEntry;
          setEntries(prev => (prev.some(e => e.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [incidentId, readOnly]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries.length]);

  useEffect(() => () => { if (pendingMedia) URL.revokeObjectURL(pendingMedia.url); }, [pendingMedia]);

  const sendText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setDraft('');
    try {
      await db.addFeedEntry({ incidentId, empNo, authorName: name, authorTeam: team, authorBadge: badge, type: 'text', content: trimmed });
    } catch (err: any) {
      alert('무전 전송 중 오류가 발생했습니다: ' + err.message);
      setDraft(trimmed);
    } finally {
      setSending(false);
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_MEDIA_BYTES) { alert('파일이 너무 큽니다 (50MB 이하만 가능).'); return; }
    const kind: 'photo' | 'video' = file.type.startsWith('video/') ? 'video' : 'photo';
    setPendingMedia({ file, url: URL.createObjectURL(file), kind });
    setCaption('');
  };

  const cancelMedia = () => {
    if (pendingMedia) URL.revokeObjectURL(pendingMedia.url);
    setPendingMedia(null);
    setCaption('');
  };

  const sendMedia = async () => {
    if (!pendingMedia || sending) return;
    setSending(true);
    try {
      const path = await db.uploadFeedMedia(incidentId, pendingMedia.file);
      await db.addFeedEntry({
        incidentId, empNo, authorName: name, authorTeam: team, authorBadge: badge,
        type: pendingMedia.kind, content: caption.trim() || null, mediaPath: path,
      });
      cancelMedia();
    } catch (err: any) {
      alert('업로드 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px', borderBottom: '1px solid var(--border-glow)' }}>
        <Radio size={18} color="var(--color-purple)" />
        <h3 style={{ margin: 0, fontSize: '14px', flex: 1 }}>현장 피드{readOnly && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · 기록 열람</span>}</h3>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{entries.length}건</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '20px' }}>불러오는 중...</div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '20px', lineHeight: 1.6 }}>
            아직 기록이 없습니다.<br />상황을 텍스트·사진·동영상으로 남겨보세요.
          </div>
        ) : entries.map(entry => {
          if (entry.type === 'system') {
            return (
              <div key={entry.id} style={{
                alignSelf: 'center', fontSize: '11px', color: 'var(--text-muted)',
                background: '#eef1f6', padding: '5px 12px', borderRadius: '999px',
              }}>
                {entry.content}
              </div>
            );
          }
          const mine = entry.emp_no === empNo;
          const mediaUrl = entry.media_path ? db.getFeedMediaUrl(entry.media_path) : null;
          return (
            <div key={entry.id} style={{
              display: 'flex', gap: '8px', maxWidth: '86%',
              alignSelf: mine ? 'flex-end' : 'flex-start',
              flexDirection: mine ? 'row-reverse' : 'row',
            }}>
              {!mine && (
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, marginTop: '15px',
                  background: avatarColor(entry.author_name), color: '#fff', fontSize: '10px', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {entry.author_name.slice(-2)}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: mine ? 'flex-end' : 'flex-start', minWidth: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: '5px', fontSize: '11px', color: 'var(--text-muted)',
                  flexDirection: mine ? 'row-reverse' : 'row',
                }}>
                  {!mine && <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>{entry.author_name}</span>}
                  {!mine && entry.author_badge && (
                    <span style={{
                      fontSize: '9.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '5px',
                      background: 'rgba(37,99,235,0.1)', color: 'var(--color-water)',
                    }}>
                      {entry.author_badge}
                    </span>
                  )}
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(entry.created_at)}</span>
                </div>

                {entry.type === 'text' && (
                  <div style={{
                    background: mine ? 'var(--color-water)' : '#eef1f6', color: mine ? '#fff' : 'var(--text-main)',
                    borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    padding: '9px 12px', fontSize: '13px', lineHeight: 1.5, wordBreak: 'break-word',
                  }}>
                    {entry.content}
                  </div>
                )}

                {entry.type === 'photo' && mediaUrl && (
                  <div style={{
                    borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    overflow: 'hidden', border: '1px solid var(--border-glow)',
                  }}>
                    <a href={mediaUrl} target="_blank" rel="noreferrer">
                      <img src={mediaUrl} alt="현장 사진" style={{ display: 'block', maxWidth: '220px', maxHeight: '220px', objectFit: 'cover' }} />
                    </a>
                    {entry.content && <div style={{ padding: '6px 10px', fontSize: '12px', background: '#fff' }}>{entry.content}</div>}
                  </div>
                )}

                {entry.type === 'video' && mediaUrl && (
                  <div style={{
                    borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    overflow: 'hidden', border: '1px solid var(--border-glow)',
                  }}>
                    <video src={mediaUrl} controls preload="metadata" style={{ display: 'block', maxWidth: '220px', maxHeight: '220px' }} />
                    {entry.content && <div style={{ padding: '6px 10px', fontSize: '12px', background: '#fff' }}>{entry.content}</div>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 프리셋 */}
      {!readOnly && (
      <div style={{ display: 'flex', gap: '6px', padding: '8px 12px', overflowX: 'auto', borderTop: '1px solid var(--border-glow)' }}>
        {PRESETS.map(p => (
          <button
            key={p} type="button" onClick={() => sendText(p)} disabled={sending}
            style={{
              flexShrink: 0, fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: '999px',
              background: 'rgba(37,99,235,0.08)', color: 'var(--color-water)', border: '1px solid rgba(37,99,235,0.25)',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {p}
          </button>
        ))}
      </div>
      )}

      {/* 선택된 미디어 미리보기 */}
      {!readOnly && pendingMedia && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--border-glow)' }}>
          {pendingMedia.kind === 'photo' ? (
            <img src={pendingMedia.url} alt="첨부 미리보기" style={{ width: '48px', height: '48px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <video src={pendingMedia.url} muted style={{ width: '48px', height: '48px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0 }} />
          )}
          <input
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="설명 (선택)"
            style={{ flex: 1, height: '38px', fontSize: '13px' }}
          />
          <button
            type="button" onClick={sendMedia} disabled={sending}
            style={{
              width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
              background: 'var(--color-water)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Send size={16} />
          </button>
          <button
            type="button" onClick={cancelMedia}
            style={{
              width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, border: '1px solid var(--border-glow)', cursor: 'pointer',
              background: '#fff', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 입력창 */}
      {!readOnly && !pendingMedia && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 12px 12px' }}>
          <input
            ref={fileInputRef} type="file" accept="image/*,video/*" capture="environment"
            onChange={handleFilePick} style={{ display: 'none' }}
          />
          <button
            type="button" onClick={() => fileInputRef.current?.click()}
            style={{
              width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, border: '1px solid var(--border-glow)', cursor: 'pointer',
              background: '#f7f9fc', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Camera size={17} />
          </button>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendText(draft); }}
            placeholder="무전 내용 입력…"
            style={{ flex: 1, height: '38px', fontSize: '13px' }}
          />
          <button
            type="button" onClick={() => sendText(draft)} disabled={sending || !draft.trim()}
            style={{
              width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
              background: draft.trim() ? 'var(--color-water)' : '#c7d2e0', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Send size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
