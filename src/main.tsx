import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// SW 사전 등록 — PWA 설치 + FCM 백그라운드 메시지 모두 사용
if ('serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(
    `${base}firebase-messaging-sw.js`,
    { scope: base }
  ).catch((e) => console.warn('[SW] 등록 실패:', e));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
