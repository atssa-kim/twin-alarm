import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAvKPBGm0jHgQb4hsPhARi7AH2stXoyTiA',
  authDomain: 'disaster-response-system-f669b.firebaseapp.com',
  projectId: 'disaster-response-system-f669b',
  storageBucket: 'disaster-response-system-f669b.firebasestorage.app',
  messagingSenderId: '116181765484',
  appId: '1:116181765484:web:d4ec2e24d409da0ef93749',
};

const VAPID_KEY = 'BCI7Cq0_RF_CMu35QL7xUSHBYr06VUVRFtz2vE1QryL_M-kAiwpQqSlKkspIhHKmYBVKNAl-J0PhfdmYzocjubU';

let messaging: Messaging | null = null;

function getFirebaseMessaging(): Messaging | null {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return null;
    const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    messaging = getMessaging(app);
    return messaging;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<string | null> {
  try {
    const msg = getFirebaseMessaging();
    if (!msg) return null;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const base = import.meta.env.BASE_URL; // dev: '/'  prod: '/twin-alarm/'
    const swReg = await navigator.serviceWorker.register(
      `${base}firebase-messaging-sw.js`,
      { scope: base }
    );

    const token = await getToken(msg, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    return token || null;
  } catch (err) {
    console.warn('[FCM] 토큰 발급 실패:', err);
    return null;
  }
}

// 앱이 포그라운드(열려있는 상태)일 때 FCM 메시지 수신 시 콜백
export function onForegroundMessage(callback: (payload: any) => void): () => void {
  const msg = getFirebaseMessaging();
  if (!msg) return () => {};
  const unsub = onMessage(msg, callback);
  return unsub;
}
