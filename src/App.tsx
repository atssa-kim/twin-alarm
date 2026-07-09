import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { type Employee, Login } from './components/Login';
import { CommanderDashboard } from './components/CommanderDashboard';
import { ResponderView } from './components/ResponderView';
import { COPDashboard } from './components/COPDashboard';
import { triggerEmergencyAlert, announceTTS, stopAllAlerts, unlockAudio } from './utils/audio';
import { db, type EmployeeDB, isIncidentParticipant } from './services/supabase';
import { requestNotificationPermission, onForegroundMessage } from './services/notifications';
import { Shield, ShieldAlert, LogOut, Radio, LayoutDashboard, ClipboardCheck, Bell, BellOff, Megaphone, Settings } from 'lucide-react';
import { AdminPanel } from './components/AdminPanel';
import { VARIANT_LABELS } from './components/CommanderDashboard';

// 알람 중복 방지 Set을 localStorage에 영구 저장 — 앱 재생성(재로딩)해도 이미 경보한
// 재난은 다시 울리지 않도록 함 (기존엔 useRef뿐이라 재생성 시 항상 초기화되어 재발화됨)
const loadPersistedSet = (key: string): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
};
const savePersistedSet = (key: string, set: Set<string>) => {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* 저장 공간 없음 등 무시 */ }
};
const ALERTED_INCIDENT_KEY = 'tt_alerted_incident_ids';
const ALERTED_MODE_KEY = 'tt_alerted_mode_keys';
const SOUND_ENABLED_KEY = 'tt_sound_enabled';
const CURRENT_VIEW_KEY = 'tt_current_view';

const App: React.FC = () => {
  const { activeIncident, responders, tasks, loading, disasterRoles } = useRealtime();
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<EmployeeDB[]>([]);
  const [currentView, setCurrentView] = useState<'cmd' | 'responder' | 'cop' | 'admin'>('responder');
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem(SOUND_ENABLED_KEY);
    return saved === null ? true : saved === 'true';
  });
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>(() => {
    return localStorage.getItem('tt_selected_voice') || '';
  });
  // 경보 중복 방지 — localStorage에 영구 저장 (앱 재생성해도 이미 경보한 재난은 재발화 안 함)
  const alertedIncidentIds = useRef<Set<string>>(loadPersistedSet(ALERTED_INCIDENT_KEY));
  const alertedModeKeys = useRef<Set<string>>(loadPersistedSet(ALERTED_MODE_KEY));
  // SW postMessage 중복 방지 — disaster|location|mode 조합으로 중복 차단 (dedup Set 클리어 안 함)
  const swAlertedKeys = useRef<Set<string>>(new Set());
  // 알림 탭으로 앱 재진입 시 TTS 강제 재생 플래그
  const pendingAlertRef = useRef(false);

  // 알림 배너
  const [showNotifBanner, setShowNotifBanner] = useState(false);

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        const voices = speechSynthesis.getVoices();
        const koVoices = voices.filter(v => v.lang.startsWith('ko') || v.lang.startsWith('KO'));
        const filteredVoices = koVoices.length > 0 ? koVoices : voices;
        setAvailableVoices(filteredVoices);
        
        // If no voice selected yet, default to Injun
        if (!selectedVoiceName && filteredVoices.length > 0) {
          const injun = filteredVoices.find(v => v.name.includes('인준') || v.name.includes('Injun') || v.name.includes('injun'));
          if (injun) {
            setSelectedVoiceName(injun.name);
            localStorage.setItem('tt_selected_voice', injun.name);
          } else {
            setSelectedVoiceName(filteredVoices[0].name);
            localStorage.setItem('tt_selected_voice', filteredVoices[0].name);
          }
        }
      }
    };
    loadVoices();
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener('voiceschanged', loadVoices);
      return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    }
  }, [selectedVoiceName]);

  // Synchronize selectedVoiceName with global window variable for audio utility
  useEffect(() => {
    if (selectedVoiceName) {
      (window as any).__tt_selected_voice = selectedVoiceName;
    }
  }, [selectedVoiceName]);

  const getCleanVoiceName = useCallback((fullName: string) => {
    if (!fullName) return '화자 선택';
    if (fullName.includes('인준') || fullName.includes('Injun')) return '인준';
    if (fullName.includes('혜미') || fullName.includes('Heami')) return '혜미';
    if (fullName.includes('선희') || fullName.includes('SunHi')) return '선희';
    if (fullName.includes('민준') || fullName.includes('Minjun')) return '민준';
    if (fullName.includes('Google') && (fullName.includes('ko') || fullName.includes('KO'))) return '구글 KO';
    return fullName
      .replace(/Microsoft\s+/g, '')
      .replace(/Google\s+/g, '')
      .replace(/\s+Online\s+\(Natural\)/g, '')
      .replace(/\s+-\s+Korean.*/g, '')
      .trim();
  }, []);

  const handleVoiceChange = useCallback((voiceName: string) => {
    setSelectedVoiceName(voiceName);
    localStorage.setItem('tt_selected_voice', voiceName);
    (window as any).__tt_selected_voice = voiceName;
    // Preview the voice
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('화자 변경 완료');
      const voices = speechSynthesis.getVoices();
      const v = voices.find(voice => voice.name === voiceName);
      if (v) { u.voice = v; u.lang = v.lang; }
      else { u.lang = 'ko-KR'; }
      u.rate = 0.95;
      speechSynthesis.speak(u);
    }
  }, []);


  // 알림 허용 배너: 로그인 후 미허용이면 표시 (세션 단위 — 로그인마다 다시 표시)
  useEffect(() => {
    if (!currentUser) { setShowNotifBanner(false); return; }
    setShowNotifBanner(notifPerm !== 'granted');
  }, [currentUser, notifPerm]);

  // 0. Fetch employee roster from DB
  useEffect(() => {
    db.getEmployees().then(setEmployees).catch(console.error);
  }, []);

  // 0-a. 알림 탭으로 앱 진입 시(?alert=1) 중복방지 Set 초기화 → TTS 강제 재생 플래그
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('alert')) {
      alertedIncidentIds.current.clear();
      alertedModeKeys.current.clear();
      swAlertedKeys.current.clear();
      savePersistedSet(ALERTED_INCIDENT_KEY, alertedIncidentIds.current);
      savePersistedSet(ALERTED_MODE_KEY, alertedModeKeys.current);
      pendingAlertRef.current = true;   // activeIncident 로드 후 TTS 즉시 재생
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // 0-b. pendingAlert 플래그 → activeIncident+currentUser 로드되면 즉시 TTS
  useEffect(() => {
    if (!pendingAlertRef.current) return;
    if (!activeIncident || !currentUser) return;
    pendingAlertRef.current = false;
    if (soundEnabled) {
      triggerEmergencyAlert(activeIncident.disaster, activeIncident.location, activeIncident.mode);
      if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 600]);
    }
  }, [activeIncident?.id, activeIncident?.mode, currentUser?.empNo, soundEnabled]);

  // 0-c. 화면 복귀 시 AudioContext 재활성화 (백그라운드 복귀 후 사이렌 묵음 방지)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') unlockAudio();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // 새 재난 발령 시 swAlertedKeys 초기화 (이전 재난 키는 새 사이클과 무관)
  useEffect(() => {
    swAlertedKeys.current.clear();
  }, [activeIncident?.id]);

  // 1. Session persistence for login
  // 재생성(재로딩) 시 마지막으로 보고 있던 화면을 유지 — 없거나 이 사용자 권한에 안 맞으면
  // 기존처럼 역할 기본값(지휘관→지휘본부, 대원→나의 임무)으로 되돌아감
  useEffect(() => {
    const savedUser = localStorage.getItem('tt_user_session');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser) as Employee;
        setCurrentUser(parsedUser);
        const savedView = localStorage.getItem(CURRENT_VIEW_KEY);
        const validViews: ('cmd' | 'responder' | 'cop' | 'admin')[] = parsedUser.isCommander
          ? ['cmd', 'responder', 'cop', 'admin']
          : ['responder'];
        if (savedView && (validViews as string[]).includes(savedView)) {
          setCurrentView(savedView as 'cmd' | 'responder' | 'cop' | 'admin');
        } else {
          setCurrentView(parsedUser.isCommander ? 'cmd' : 'responder');
        }
      } catch (e) {
        localStorage.removeItem('tt_user_session');
      }
    }
  }, []);

  // currentView가 바뀔 때마다 저장 — 다음 재생성 시 그대로 복원
  useEffect(() => {
    localStorage.setItem(CURRENT_VIEW_KEY, currentView);
  }, [currentView]);

  const handleLogin = async (user: Employee) => {
    setCurrentUser(user);
    localStorage.setItem('tt_user_session', JSON.stringify(user));
    setCurrentView(user.isCommander ? 'cmd' : 'responder');
    unlockAudio();
    // FCM 토큰 발급 및 저장 (백그라운드 알람 등록)
    try {
      const token = await requestNotificationPermission();
      if (token) {
        await db.saveFcmToken(user.empNo, token);
        setNotifPerm('granted');
      } else {
        setNotifPerm('Notification' in window ? Notification.permission : 'denied');
      }
    } catch (e) {
      console.warn('[FCM] 등록 실패:', e);
    }
  };

  const handleEnableNotif = async () => {
    if (!currentUser) return;

    if (!('Notification' in window)) {
      alert('이 브라우저는 알림을 지원하지 않습니다.\nChrome 또는 Edge를 사용해 주세요.');
      return;
    }

    if (Notification.permission === 'denied') {
      alert(
        '알림이 차단되어 있습니다.\n\n' +
        '📱 Chrome(Android):\n' +
        '  주소창 왼쪽 🔒 → 사이트 설정 → 알림 → 허용\n\n' +
        '🖥️ Chrome/Edge(PC):\n' +
        '  주소창 왼쪽 🔒 → 알림 → 허용\n\n' +
        '변경 후 이 버튼을 다시 탭하세요.'
      );
      return;
    }

    try {
      const token = await requestNotificationPermission();
      const perm = Notification.permission as NotificationPermission;
      setNotifPerm(perm);

      if (token) {
        await db.saveFcmToken(currentUser.empNo, token);
        alert('✅ 알림 등록 완료!\n이제 발령 시 이 기기(Chrome)로 알림이 옵니다.');
      } else if (perm === 'granted') {
        alert('⚠️ 알림 권한은 허용됐으나 FCM 토큰 발급 실패.\nVPNㆍ방화벽 환경이면 모바일 데이터로 시도해 보세요.');
      } else {
        alert('알림 허용이 필요합니다.\n팝업에서 "허용"을 선택해 주세요.');
      }
    } catch (e: any) {
      console.warn('[FCM] 등록 실패:', e);
      alert('알림 등록 실패: ' + (e?.message ?? e));
    }
  };

  const handleLogout = () => {
    if (window.confirm('로그아웃 하시겠습니까?')) {
      setCurrentUser(null);
      localStorage.removeItem('tt_user_session');
    }
  };

  const vibrateAlert = () => {
    if ('vibrate' in navigator) navigator.vibrate([400, 150, 400, 150, 600]);
  };

  // FCM 포그라운드 메시지 수신 (앱이 열려있을 때 FCM 도착)
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onForegroundMessage((payload) => {
      const n = payload.notification || {};
      const data = payload.data || {};
      if (soundEnabled) {
        triggerEmergencyAlert(
          data.disaster || n.title || '재난',
          data.location || '',
          data.mode || '실제'
        );
        vibrateAlert();
      }
    });
    return unsub;
  }, [currentUser, soundEnabled]);

  // SW 백그라운드 메시지 → 탭이 열려 있을 때 즉시 TTS/사이렌
  // (dedup Set을 clear하지 않고, 콘텐츠 기반 키로 중복 차단 → 탭 복귀 시 재발화 방지)
  useEffect(() => {
    if (!currentUser || !('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'BACKGROUND_ALERT') return;
      if (!soundEnabled) return;
      // 서버(FCM 발송)에서 이미 대상자를 걸러 보내지만, 클라이언트에서도 한 번 더 확인
      if (currentUser && activeIncident && !isIncidentParticipant(activeIncident, currentUser.empNo)) return;
      const { disaster, location, mode } = event.data;
      const key = `${disaster}|${location}|${mode}`;
      if (swAlertedKeys.current.has(key)) return; // 이미 처리한 알림
      swAlertedKeys.current.add(key);
      // 메인 dedup에도 추가 (기존 항목 유지 — clear 금지)
      if (activeIncident) {
        alertedIncidentIds.current.add(activeIncident.id);
        alertedModeKeys.current.add(`${activeIncident.id}__${activeIncident.mode}`);
        savePersistedSet(ALERTED_INCIDENT_KEY, alertedIncidentIds.current);
        savePersistedSet(ALERTED_MODE_KEY, alertedModeKeys.current);
      }
      triggerEmergencyAlert(disaster || '재난', location || '', mode || '실제');
      vibrateAlert();
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [currentUser, soundEnabled, activeIncident?.id, activeIncident?.mode]);

  // 2. 신규 발령 경보 — 로그인 후 + 동일 incident ID는 한 번만
  useEffect(() => {
    if (!activeIncident || !currentUser) return;
    if (alertedIncidentIds.current.has(activeIncident.id)) return;
    // 훈련 발령을 특정 대원으로 제한한 경우, 선택 안 된 대원에게는 알람을 울리지 않음
    if (!isIncidentParticipant(activeIncident, currentUser.empNo)) return;

    alertedIncidentIds.current.add(activeIncident.id);
    // 초기 mode도 Set에 등록해 effect 3의 중복 방지
    alertedModeKeys.current.add(`${activeIncident.id}__${activeIncident.mode}`);
    savePersistedSet(ALERTED_INCIDENT_KEY, alertedIncidentIds.current);
    savePersistedSet(ALERTED_MODE_KEY, alertedModeKeys.current);

    if (soundEnabled) {
      triggerEmergencyAlert(activeIncident.disaster, activeIncident.location, activeIncident.mode);
      vibrateAlert();
    }
  }, [activeIncident?.id, currentUser?.empNo]);

  // 3. 승격 경보 — 로그인 후 + mode가 바뀔 때만 (동일 mode 재진입은 무시)
  useEffect(() => {
    if (!activeIncident || !currentUser) return;
    const key = `${activeIncident.id}__${activeIncident.mode}`;
    if (alertedModeKeys.current.has(key)) return;
    // 훈련 발령을 특정 대원으로 제한한 경우, 선택 안 된 대원에게는 알람을 울리지 않음
    if (!isIncidentParticipant(activeIncident, currentUser.empNo)) return;

    alertedModeKeys.current.add(key);
    savePersistedSet(ALERTED_MODE_KEY, alertedModeKeys.current);
    if (soundEnabled) {
      triggerEmergencyAlert(activeIncident.disaster, activeIncident.location, activeIncident.mode);
      vibrateAlert();
    }
  }, [activeIncident?.mode, currentUser?.empNo]);

  // 4. 상황 확정(variant) 알림 — 공통으로 되돌리는 경우(null)는 조용히 처리, TTS는 재생하지 않음
  useEffect(() => {
    if (!activeIncident || !currentUser || !activeIncident.variant) return;
    const key = `${activeIncident.id}__variant__${activeIncident.variant}`;
    if (alertedModeKeys.current.has(key)) return;
    if (!isIncidentParticipant(activeIncident, currentUser.empNo)) return;

    alertedModeKeys.current.add(key);
    savePersistedSet(ALERTED_MODE_KEY, alertedModeKeys.current);
    if (soundEnabled) {
      const label = (VARIANT_LABELS[activeIncident.variant] ?? activeIncident.variant).replace(/^\S+\s+/, '');
      announceTTS(`${activeIncident.disaster} 상황이 ${label}로 확정되었습니다. 임무를 확인하세요.`);
    }
  }, [activeIncident?.variant, currentUser?.empNo]);

  // Loading Screen
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'var(--navy)',
        color: '#f8fafc',
        fontFamily: 'var(--font-body)'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid rgba(255, 255, 255, 0.1)',
          borderTopColor: '#3b82f6',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: '16px'
        }}></div>
        <div style={{ fontSize: '14px', fontWeight: 600 }}>실시간 시스템 연결 중...</div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Not logged in view
  if (!currentUser) {
    return (
      <div id="app">
        <Login
          onLogin={handleLogin}
          employees={employees}
        />
      </div>
    );
  }

  return (
    <div id="app">
      {/* Top sticky bar */}
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeIncident ? (
            <ShieldAlert size={20} color="#f87171" />
          ) : (
            <Shield size={20} color="#34d399" />
          )}
          <a
            href="https://atssa-kim.github.io/disa_app/"
            target="disa_app_window"
            rel="noopener noreferrer"
            className="topbar-title"
            style={{ textDecoration: 'none', cursor: 'pointer' }}
          >
            Twin-alarm
          </a>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 알림(FCM) 허용 버튼 */}
          <button
            onClick={handleEnableNotif}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
              color: notifPerm === 'granted' ? '#22c55e' : notifPerm === 'denied' ? '#ef4444' : '#f59e0b',
            }}
            title={
              notifPerm === 'granted' ? '알림 활성화됨' :
              notifPerm === 'denied'  ? '알림 차단됨 — 탭하여 해제 방법 확인' :
                                        '탭하여 알림 허용'
            }
          >
            {notifPerm === 'granted' ? <Bell size={18} /> : <BellOff size={18} />}
            <span style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1 }}>
              {notifPerm === 'granted' ? '활성' : notifPerm === 'denied' ? '차단' : '알림'}
            </span>
          </button>

          {/* Sound toggle button */}
          <button
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              localStorage.setItem(SOUND_ENABLED_KEY, String(next));
              unlockAudio();
              if (!next) stopAllAlerts();
            }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
              color: soundEnabled ? '#f87171' : 'var(--on-navy-muted)',
              opacity: soundEnabled ? 1 : 0.5,
            }}
            title={soundEnabled ? '육성 안내 켜짐' : '육성 안내 꺼짐'}
          >
            <Megaphone size={18} />
            <span style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1 }}>
              {soundEnabled ? '음성' : '음소거'}
            </span>
          </button>

          <span className="badge badge-live">LIVE</span>

          <button
            onClick={handleLogout}
            style={{
              background: 'transparent', border: 'none',
              color: '#f87171', cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
            }}
            title="로그아웃"
          >
            <LogOut size={18} />
            <span style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1, color: '#f87171' }}>exit</span>
          </button>
        </div>
      </header>

      {/* Top Navigation Menu (topbar 바로 아래 고정) */}
      <nav style={{
        display: 'flex',
        background: 'var(--navy)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        height: '56px',
        alignItems: 'center',
        padding: '0 8px',
        margin: '8px 14px 0',
        position: 'sticky',
        top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
        zIndex: 90,
        overflowX: 'auto',
      }}>
        <button
          onClick={() => setCurrentView('cmd')}
          style={{
            flex: '1 1 0', minWidth: '68px',
            background: currentView === 'cmd' ? 'rgba(255,255,255,0.16)' : 'transparent',
            border: 'none', borderRadius: '10px', margin: '0 2px',
            color: currentView === 'cmd' ? 'var(--on-navy)' : 'var(--on-navy-muted)', transition: 'all 0.25s ease',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '3px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: '6px 0',
          }}
        >
          <LayoutDashboard size={17} />
          <span style={{ whiteSpace: 'nowrap' }}>지휘본부</span>
        </button>
        <button
          onClick={() => setCurrentView('responder')}
          style={{
            flex: '1 1 0', minWidth: '68px',
            background: currentView === 'responder' ? 'rgba(255,255,255,0.16)' : 'transparent',
            border: 'none', borderRadius: '10px', margin: '0 2px',
            color: currentView === 'responder' ? 'var(--on-navy)' : 'var(--on-navy-muted)', transition: 'all 0.25s ease',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '3px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: '6px 0',
          }}
        >
          <ClipboardCheck size={17} />
          <span style={{ whiteSpace: 'nowrap' }}>나의 임무</span>
        </button>
        <button
          onClick={() => setCurrentView('cop')}
          style={{
            flex: '1 1 0', minWidth: '68px',
            background: currentView === 'cop' ? 'rgba(255,255,255,0.16)' : 'transparent',
            border: 'none', borderRadius: '10px', margin: '0 2px',
            color: currentView === 'cop' ? 'var(--on-navy)' : 'var(--on-navy-muted)', transition: 'all 0.25s ease',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '3px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: '6px 0',
          }}
        >
          <Radio size={17} />
          <span style={{ whiteSpace: 'nowrap' }}>상황판</span>
        </button>
        {currentUser.isCommander && currentUser.name === '김견수' && (
          <button
            onClick={() => setCurrentView('admin')}
            style={{
              flex: '1 1 0', minWidth: '68px',
              background: currentView === 'admin' ? 'rgba(255,255,255,0.16)' : 'transparent',
              border: 'none', borderRadius: '10px', margin: '0 2px',
              color: currentView === 'admin' ? 'var(--on-navy)' : 'var(--on-navy-muted)', transition: 'all 0.25s ease',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '3px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', padding: '6px 0',
            }}
          >
            <Settings size={17} />
            <span style={{ whiteSpace: 'nowrap' }}>조직관리</span>
          </button>
        )}
      </nav>

      {/* ── 알림 허용 배너 ── */}
      {showNotifBanner && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 12px 0' }}>

          {/* 알림 허용 배너 */}
          {showNotifBanner && notifPerm !== 'granted' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(220,38,38,0.06))',
              border: '1px solid rgba(239,68,68,0.3)',
            }}>
              <BellOff size={18} color="#ef4444" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#ef4444' }}>알림 허용 필요</div>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                  허용해야 화면 꺼진 상태에서 발령 알람 수신
                </div>
              </div>
              <button type="button" onClick={handleEnableNotif} style={{
                padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', flexShrink: 0,
                fontSize: '11px', fontWeight: 700,
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                color: '#ef4444',
              }}>허용</button>
              <button type="button" onClick={() => setShowNotifBanner(false)} style={{
                background: 'transparent', border: 'none', color: '#475569',
                cursor: 'pointer', fontSize: '11px', padding: '2px 4px', flexShrink: 0,
              }}>나중에</button>
            </div>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {currentView === 'cmd' && (
          <CommanderDashboard
            activeIncident={activeIncident}
            responders={responders}
            tasks={tasks}
            currentUser={currentUser}
            employees={employees}
            isCommander={currentUser.isCommander}
            availableVoices={availableVoices}
            selectedVoiceName={selectedVoiceName}
            getCleanVoiceName={getCleanVoiceName}
            handleVoiceChange={handleVoiceChange}
          />
        )}

        {currentView === 'responder' && (
          <ResponderView
            activeIncident={activeIncident}
            responders={responders}
            tasks={tasks}
            currentUser={currentUser}
            disasterRoles={disasterRoles}
          />
        )}

        {currentView === 'cop' && (
          <COPDashboard
            activeIncident={activeIncident}
            responders={responders}
            tasks={tasks}
          />
        )}

        {currentView === 'admin' && currentUser.isCommander && currentUser.name === '김견수' && (
          <AdminPanel
            employees={employees}
            onRefresh={() => db.getEmployees().then(setEmployees).catch(console.error)}
          />
        )}

      </main>

    </div>
  );
};

export default App;
