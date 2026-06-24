importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAvKPBGm0jHgQb4hsPhARi7AH2stXoyTiA",
  authDomain: "disaster-response-system-f669b.firebaseapp.com",
  projectId: "disaster-response-system-f669b",
  storageBucket: "disaster-response-system-f669b.firebasestorage.app",
  messagingSenderId: "116181765484",
  appId: "1:116181765484:web:d4ec2e24d409da0ef93749"
});

const messaging = firebase.messaging();

// 앱이 백그라운드(꺼진 상태)일 때 푸시 수신
messaging.onBackgroundMessage(function(payload) {
  const n = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(n.title || '🚨 재난 발령', {
    body: n.body || '앱을 열어 임무를 확인하세요.',
    icon: '/twin-alarm/favicon.png',
    badge: '/twin-alarm/favicon.png',
    tag: 'twin-alarm-incident',
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 600],
    data: { link: 'https://atssa-kim.github.io/twin-alarm/', ...data }
  });
});

// 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link)
    || 'https://atssa-kim.github.io/twin-alarm/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes('twin-alarm') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
