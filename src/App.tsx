import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { type Employee, Login } from './components/Login';
import { CommanderDashboard } from './components/CommanderDashboard';
import { ResponderView } from './components/ResponderView';
import { COPDashboard } from './components/COPDashboard';
import { triggerEmergencyAlert, unlockAudio } from './utils/audio';
import { Shield, ShieldAlert, LogOut, Radio, LayoutDashboard, ClipboardCheck, Mic } from 'lucide-react';

const App: React.FC = () => {
  const { activeIncident, responders, tasks, loading } = useRealtime();
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [currentView, setCurrentView] = useState<'cmd' | 'responder' | 'cop'>('responder');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>(() => {
    return localStorage.getItem('tt_selected_voice') || '';
  });
  const lastAlertIdRef = useRef<string | null>(null);
  const voicePickerRef = useRef<HTMLDivElement>(null);

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

  // Close voice picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (voicePickerRef.current && !voicePickerRef.current.contains(e.target as Node)) {
        setShowVoicePicker(false);
      }
    };
    if (showVoicePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showVoicePicker]);

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
    setShowVoicePicker(false);
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

  const handleLogin = (user: Employee) => {
    setCurrentUser(user);
    localStorage.setItem('tt_user_session', JSON.stringify(user));
    setCurrentView(user.isCommander ? 'cmd' : 'responder');
    unlockAudio();
  };

  const handleLogout = () => {
    if (window.confirm('로그아웃 하시겠습니까?')) {
      setCurrentUser(null);
      localStorage.removeItem('tt_user_session');
    }
  };

  // 2. Play emergency sound alert when a new active incident is triggered
  useEffect(() => {
    if (activeIncident && activeIncident.id !== lastAlertIdRef.current) {
      lastAlertIdRef.current = activeIncident.id;
      if (soundEnabled) {
        triggerEmergencyAlert(
          activeIncident.disaster,
          activeIncident.location,
          activeIncident.mode === '훈련'
        );
      }
    } else if (!activeIncident) {
      lastAlertIdRef.current = null;
    }
  }, [activeIncident, soundEnabled]);

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
          availableVoices={availableVoices}
          selectedVoiceName={selectedVoiceName}
          onVoiceChange={handleVoiceChange}
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
          <span className="topbar-title">TwinTower Ops</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Sound toggle button */}
          <button
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              unlockAudio();
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px'
            }}
            title={soundEnabled ? "음성 안내 켜짐" : "음성 안내 꺼짐"}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>

          {/* Voice picker toggle */}
          <div ref={voicePickerRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowVoicePicker(!showVoicePicker)}
              style={{
                background: showVoicePicker ? 'rgba(59,130,246,0.15)' : 'rgba(255, 255, 255, 0.05)',
                border: showVoicePicker ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                color: showVoicePicker ? '#60a5fa' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                transition: 'all 0.2s ease',
                fontSize: '12px',
                fontWeight: 600
              }}
              title="TTS 화자 선택"
            >
              <Mic size={14} style={{ color: showVoicePicker ? '#60a5fa' : '#94a3b8' }} />
              <span style={{ maxWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {getCleanVoiceName(selectedVoiceName)}
              </span>
              <span style={{ fontSize: '9px', opacity: 0.7 }}>▼</span>
            </button>

            {/* Voice dropdown */}
            {showVoicePicker && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '8px',
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                padding: '8px 0',
                minWidth: '240px',
                maxHeight: '280px',
                overflowY: 'auto',
                zIndex: 1000,
                boxShadow: '0 12px 40px rgba(0,0,0,0.5)'
              }}>
                <div style={{ padding: '8px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🎙 TTS 화자 선택</span>
                </div>
                {availableVoices.length === 0 ? (
                  <div style={{ padding: '12px 16px', color: '#64748b', fontSize: '13px' }}>사용 가능한 한국어 화자가 없습니다</div>
                ) : (
                  availableVoices.map((voice) => (
                    <button
                      key={voice.name}
                      onClick={() => handleVoiceChange(voice.name)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        width: '100%',
                        padding: '10px 16px',
                        background: selectedVoiceName === voice.name ? 'rgba(59,130,246,0.15)' : 'transparent',
                        border: 'none',
                        color: selectedVoiceName === voice.name ? '#60a5fa' : '#e2e8f0',
                        fontSize: '13px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s ease'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = selectedVoiceName === voice.name ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = selectedVoiceName === voice.name ? 'rgba(59,130,246,0.15)' : 'transparent')}
                    >
                      <span style={{ width: '18px', textAlign: 'center' }}>{selectedVoiceName === voice.name ? '✓' : ''}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{voice.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <span className="badge badge-live">LIVE</span>
          
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-fire)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4px'
            }}
            title="로그아웃"
          >
            <LogOut size={22} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {currentView === 'cmd' && currentUser.isCommander && (
          <CommanderDashboard
            activeIncident={activeIncident}
            responders={responders}
            tasks={tasks}
            currentUser={currentUser}
          />
        )}

        {currentView === 'responder' && (
          <ResponderView
            activeIncident={activeIncident}
            responders={responders}
            tasks={tasks}
            currentUser={currentUser}
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

      {/* Bottom Navigation Menu */}
      <nav style={{
        display: 'flex',
        background: 'rgba(15, 23, 42, 0.9)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        height: '64px',
        alignItems: 'center',
        padding: '0 8px'
      }}>
        {currentUser.isCommander && (
          <button
            onClick={() => setCurrentView('cmd')}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: currentView === 'cmd' ? '#3b82f6' : 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <LayoutDashboard size={18} />
            <span>지휘본부</span>
          </button>
        )}

        <button
          onClick={() => setCurrentView('responder')}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: currentView === 'responder' ? '#3b82f6' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <ClipboardCheck size={18} />
          <span>나의 임무</span>
        </button>

        <button
          onClick={() => setCurrentView('cop')}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: currentView === 'cop' ? '#3b82f6' : 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          <Radio size={18} />
          <span>상황판 (COP)</span>
        </button>
      </nav>
    </div>
  );
};

export default App;
