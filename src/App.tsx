import React, { useState, useEffect, useRef } from 'react';
import { useRealtime } from './hooks/useRealtime';
import { type Employee, Login } from './components/Login';
import { CommanderDashboard } from './components/CommanderDashboard';
import { ResponderView } from './components/ResponderView';
import { COPDashboard } from './components/COPDashboard';
import { triggerEmergencyAlert, unlockAudio } from './utils/audio';
import { Shield, ShieldAlert, LogOut, Radio, LayoutDashboard, ClipboardCheck } from 'lucide-react';

const App: React.FC = () => {
  const { activeIncident, responders, tasks, loading } = useRealtime();
  const [currentUser, setCurrentUser] = useState<Employee | null>(null);
  const [currentView, setCurrentView] = useState<'cmd' | 'responder' | 'cop'>('responder');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const lastAlertIdRef = useRef<string | null>(null);

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
    return <Login onLogin={handleLogin} />;
  }

  return (
    <>
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
            <LogOut size={16} />
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
    </>
  );
};

export default App;
