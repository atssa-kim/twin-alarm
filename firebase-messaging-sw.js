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

function computeTtsBody(mode, disaster, location) {
  if (mode === '훈련/감지기') {
    return '훈련상황! 훈련상황 ' + location + '에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.';
  } else if (mode === '훈련/전체') {
    return '훈련상황! 화재발생! 훈련상황! 화재발생! ' + location + '으로 신속히 출동하시기 바랍니다.';
  } else if (mode === '실제/감지기') {
    return '화재감지기동작!, 화재감지기동작! ' + location + '에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.';
  } else if (mode === '실제/화재') {
    return '화재발생!, 화재발생! ' + location + '에서 화재발생 신속히 출동하시기 바랍니다.';
  } else if (mode.indexOf('훈련') === 0) {
    return '훈련 ' + disaster + '발생!, 훈련 ' + disaster + '발생! ' + location + '에서 훈련 ' + disaster + '발생 신속히 출동하시기 바랍니다.';
  } else {
    return (disaster || '재난') + '발생!, ' + (disaster || '재난') + '발생! ' + location + '에서 ' + (disaster || '재난') + '발생 신속히 출동하시기 바랍니다.';
  }
}

// 앱이 백그라운드(꺼진 상태)일 때 FCM 수신
messaging.onBackgroundMessage(function(payload) {
  var n = payload.notification || {};
  var data = payload.data || {};

  var mode = data.mode || '';
  var disaster = data.disaster || '';
  var location = data.location || '';
  var ttsBody = computeTtsBody(mode, disaster, location);

  var notifTitle = n.title || (mode.indexOf('훈련') === 0 ? '🏋️ 훈련 발령' : '🚨 재난 발령');

  // 1) 열려 있는 탭에 postMessage → 즉시 TTS/사이렌 재생 (백그라운드 탭 대응)
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
    windowClients.forEach(function(client) {
      client.postMessage({
        type: 'BACKGROUND_ALERT',
        mode: mode,
        disaster: disaster,
        location: location,
        ttsText: ttsBody
      });
    });

    // 2) 시스템 알림 표시 (앱 완전 종료 시 유일한 신호)
    //    탭이 이미 열려 있어도 알림은 표시 (시각적 확인용)
    self.registration.showNotification(notifTitle, {
      body: ttsBody,
      icon: '/twin-alarm/favicon.png',
      badge: '/twin-alarm/favicon.png',
      tag: 'twin-alarm-incident',
      renotify: true,
      requireInteraction: true,
      // 강한 진동: 긴 울림 → 짧은 쉼 반복 5회
      vibrate: [800, 200, 800, 200, 800, 200, 800, 200, 1200],
      silent: false,
      data: { link: 'https://atssa-kim.github.io/twin-alarm/', mode: mode, disaster: disaster, location: location }
    });
  });
});

// 알림 클릭 시 앱 열기 — ?alert=1 파라미터로 TTS 강제 재생
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var base = 'https://atssa-kim.github.io/twin-alarm/';
  var alertUrl = base + '?alert=1';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes('twin-alarm') && 'focus' in client) {
          client.focus();
          client.navigate(alertUrl);
          return;
        }
      }
      return clients.openWindow(alertUrl);
    })
  );
});
