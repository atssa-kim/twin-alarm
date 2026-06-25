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

  // TTS 멘트와 동일한 본문 계산
  var mode = data.mode || '';
  var disaster = data.disaster || '';
  var location = data.location || '';
  var ttsBody;
  if (mode === '훈련/감지기') {
    ttsBody = '훈련상황! 훈련상황 ' + location + '에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.';
  } else if (mode === '훈련/전체') {
    ttsBody = '훈련상황! 화재발생! 훈련상황! 화재발생! ' + location + '으로 신속히 출동하시기 바랍니다.';
  } else if (mode === '실제/감지기') {
    ttsBody = '화재감지기동작!, 화재감지기동작! ' + location + '에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.';
  } else if (mode === '실제/화재') {
    ttsBody = '화재발생!, 화재발생! ' + location + '에서 화재발생 신속히 출동하시기 바랍니다.';
  } else if (mode.indexOf('훈련') === 0) {
    ttsBody = '훈련 ' + disaster + '발생!, 훈련 ' + disaster + '발생! ' + location + '에서 훈련 ' + disaster + '발생 신속히 출동하시기 바랍니다.';
  } else {
    ttsBody = (disaster || '재난') + '발생!, ' + (disaster || '재난') + '발생! ' + location + '에서 ' + (disaster || '재난') + '발생 신속히 출동하시기 바랍니다.';
  }

  self.registration.showNotification(n.title || '🚨 재난 발령', {
    body: ttsBody || n.body || '앱을 열어 임무를 확인하세요.',
    icon: '/twin-alarm/favicon.png',
    badge: '/twin-alarm/favicon.png',
    tag: 'twin-alarm-incident',
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 600],
    data: { link: 'https://atssa-kim.github.io/twin-alarm/', ...data }
  });
});

// 알림 클릭 시 앱 열기 — ?alert=1 파라미터로 TTS 강제 재생
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const base = 'https://atssa-kim.github.io/twin-alarm/';
  const alertUrl = base + '?alert=1';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes('twin-alarm') && 'focus' in client) {
          // 이미 열린 탭이 있으면 포커스 + URL 변경으로 alert 트리거
          client.focus();
          client.navigate(alertUrl);
          return;
        }
      }
      return clients.openWindow(alertUrl);
    })
  );
});
