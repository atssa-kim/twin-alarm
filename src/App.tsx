import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { type Employee, Login } from './components/Login';
import { CommanderDashboard } from './components/CommanderDashboard';
import { ResponderView } from './components/ResponderView';
import { COPDashboard } from './components/COPDashboard';
import { triggerEmergencyAlert, stopAllAlerts, unlockAudio } from './utils/audio';
import { db, type EmployeeDB } from './services/supabase';
import { requestNotificationPermission, onForegroundMessage } from './services/notifications';
import { Shield, ShieldAlert, LogOut, Radio, LayoutDashboard, ClipboardCheck, Bell, BellOff, Megaphone } from 'lucide-react';

const App: React.FC = () => {
  const { activeIncident, responders, tasks, loading, disasterRoles } = useRealtime();
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<EmployeeDB[]>([]);
  const [currentView, setCurrentView] = useState<'cmd' | 'responder' | 'cop' | 'log'>('responder');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied'
  );
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>(() => {
    return localStorage.getItem('tt_selected_voice') || '';
  });
  // 경보 중복 방지 — Set 기반 (탭 전환 후 복귀해도 재발령 없음)
  const alertedIncidentIds = useRef<Set<string>>(new Set());
  const alertedModeKeys = useRef<Set<string>>(new Set());
  // SW postMessage 중복 방지 — disaster|location|mode 조합으로 중복 차단 (dedup Set 클리어 안 함)
  const swAlertedKeys = useRef<Set<string>>(new Set());

  // PWA 설치 / 알림 배너
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isPWAInstalled = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

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

  // PWA 설치 프롬프트 캡처 (Android Chrome)
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
      if (!isPWAInstalled && !localStorage.getItem('tt_install_dismissed')) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [isPWAInstalled]);

  // iOS: 로그인 후 설치 배너 표시
  useEffect(() => {
    if (currentUser && isIOS && !isPWAInstalled && !localStorage.getItem('tt_install_dismissed')) {
      setShowInstallBanner(true);
    }
  }, [currentUser, isIOS, isPWAInstalled]);

  // 알림 허용 배너: 로그인 후 미허용이면 표시 (세션 단위 — 로그인마다 다시 표시)
  useEffect(() => {
    if (!currentUser) { setShowNotifBanner(false); return; }
    setShowNotifBanner(notifPerm !== 'granted');
  }, [currentUser, notifPerm]);

  // 0. Fetch employee roster from DB
  useEffect(() => {
    db.getEmployees().then(setEmployees).catch(console.error);
  }, []);

  // 0-a. 알림 탭으로 앱 진입 시(?alert=1) 중복방지 Set 초기화 → TTS 강제 재생
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('alert')) {
      alertedIncidentIds.current.clear();
      alertedModeKeys.current.clear();
      swAlertedKeys.current.clear();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // 새 재난 발령 시 swAlertedKeys 초기화 (이전 재난 키는 새 사이클과 무관)
  useEffect(() => {
    swAlertedKeys.current.clear();
  }, [activeIncident?.id]);

  // 1. Session persistence for login
  useEffect(() => {
    const savedUser = localStorage.getItem('tt_user_session');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser) as Employee;
        setCurrentUser(parsedUser);
        setCurrentView(parsedUser.isCommander ? 'cmd' : 'responder');
      } catch (e) {
        localStorage.removeItem('tt_user_session');
      }
    }
  }, []);

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

  const handleInstall = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      setShowInstallBanner(false);
      setDeferredInstallPrompt(null);
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
      const { disaster, location, mode } = event.data;
      const key = `${disaster}|${location}|${mode}`;
      if (swAlertedKeys.current.has(key)) return; // 이미 처리한 알림
      swAlertedKeys.current.add(key);
      // 메인 dedup에도 추가 (기존 항목 유지 — clear 금지)
      if (activeIncident) {
        alertedIncidentIds.current.add(activeIncident.id);
        alertedModeKeys.current.add(`${activeIncident.id}__${activeIncident.mode}`);
      }
      triggerEmergencyAlert(disaster || '재난', location || '', mode || '실제');
      vibrateAlert();
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [currentUser, soundEnabled, activeIncident?.id, activeIncident?.mode]);

  // 2. 신규 발령 경보 — 동일 incident ID는 한 번만 발령
  useEffect(() => {
    if (!activeIncident) return;
    if (alertedIncidentIds.current.has(activeIncident.id)) return;

    alertedIncidentIds.current.add(activeIncident.id);
    // 초기 mode도 Set에 등록해 effect 3의 중복 방지
    alertedModeKeys.current.add(`${activeIncident.id}__${activeIncident.mode}`);

    if (soundEnabled) {
      triggerEmergencyAlert(activeIncident.disaster, activeIncident.location, activeIncident.mode);
      vibrateAlert();
    }
  }, [activeIncident?.id]);

  // 3. 승격 경보 — mode가 바뀔 때만 (동일 mode 재진입은 무시)
  useEffect(() => {
    if (!activeIncident) return;
    const key = `${activeIncident.id}__${activeIncident.mode}`;
    if (alertedModeKeys.current.has(key)) return;

    alertedModeKeys.current.add(key);
    if (soundEnabled) {
      triggerEmergencyAlert(activeIncident.disaster, activeIncident.location, activeIncident.mode);
      vibrateAlert();
    }
  }, [activeIncident?.mode]);

  // Loading Screen
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#090d16',
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
            <ShieldAlert size={20} color="var(--color-fire)" />
          ) : (
            <Shield size={20} color="var(--color-green)" />
          )}
          <a
            href="https://atssa-kim.github.io/disa_app/"
            target="_blank"
            rel="noopener noreferrer"
            className="topbar-title"
            style={{ textDecoration: 'none', cursor: 'pointer' }}
          >
            Twin-alarm/대응
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
              unlockAudio();
              if (!next) stopAllAlerts();
            }}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
              color: soundEnabled ? '#ef4444' : 'var(--text-muted)',
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
              color: 'var(--color-fire)', cursor: 'pointer',
              padding: '2px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
            }}
            title="로그아웃"
          >
            <LogOut size={18} />
            <span style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1, color: 'var(--color-fire)' }}>exit</span>
          </button>
        </div>
      </header>

      {/* Top Navigation Menu (topbar 바로 아래 고정) */}
      <nav style={{
        display: 'flex',
        background: 'rgba(15, 23, 42, 0.9)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        height: '56px',
        alignItems: 'center',
        padding: '0 8px',
        margin: '8px 12px 0',
        position: 'sticky',
        top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
        zIndex: 90,
      }}>
        <button
          onClick={() => setCurrentView('cmd')}
          style={{
            flex: '1 1 0', minWidth: 0, background: 'transparent', border: 'none',
            color: currentView === 'cmd' ? '#3b82f6' : 'var(--text-muted)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '3px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'
          }}
        >
          <LayoutDashboard size={17} />
          <span>지휘본부</span>
        </button>
        <button
          onClick={() => {
            if (!activeIncident) {
              window.open('https://atssa-kim.github.io/disa_app/', '_blank');
            } else {
              setCurrentView('responder');
            }
          }}
          style={{
            flex: '1 1 0', minWidth: 0, background: 'transparent', border: 'none',
            color: currentView === 'responder' ? '#3b82f6' : 'var(--text-muted)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '3px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'
          }}
        >
          <ClipboardCheck size={17} />
          <span>나의 임무</span>
        </button>
        <button
          onClick={() => setCurrentView('cop')}
          style={{
            flex: '1 1 0', minWidth: 0, background: 'transparent', border: 'none',
            color: currentView === 'cop' ? '#3b82f6' : 'var(--text-muted)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '3px', fontSize: '11px', fontWeight: 700, cursor: 'pointer'
          }}
        >
          <Radio size={17} />
          <span>업무수행율</span>
        </button>
      </nav>

      {/* ── PWA 설치 / 알림 허용 배너 ── */}
      {(showInstallBanner || showNotifBanner) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 12px 0' }}>
          {/* PWA 설치 배너 */}
          {showInstallBanner && !isPWAInstalled && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(217,119,6,0.06))',
              border: '1px solid rgba(245,158,11,0.3)',
            }}>
              <span style={{ fontSize: '20px', flexShrink: 0 }}>📱</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24' }}>홈 화면에 앱 추가</div>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                  {isIOS
                    ? '하단 공유버튼 □↑ → 홈 화면에 추가 → 추가'
                    : '설치하면 화면 꺼진 상태에서도 알람이 울립니다'}
                </div>
              </div>
              {!isIOS && deferredInstallPrompt && (
                <button type="button" onClick={handleInstall} style={{
                  padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', flexShrink: 0,
                  fontSize: '11px', fontWeight: 700,
                  background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.5)',
                  color: '#fbbf24',
                }}>설치</button>
              )}
              <button type="button" onClick={() => { setShowInstallBanner(false); localStorage.setItem('tt_install_dismissed', '1'); }} style={{
                background: 'transparent', border: 'none', color: '#475569',
                cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px', flexShrink: 0,
              }}>✕</button>
            </div>
          )}

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

      </main>

    </div>
  );
};

export default App;
