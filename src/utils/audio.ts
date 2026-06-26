// Synthesized Emergency Sound Generator (AudioContext + TTS)

let audioCtx: AudioContext | null = null;
let activeOscillators: OscillatorNode[] = [];
let activeGainNode: GainNode | null = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (AC && !audioCtx) {
      audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (e) {
    console.warn('AudioContext failed to initialize:', e);
  }

  // Speak dummy speech for iOS synthesis pre-activation
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch (e) {}
}

export function stopSiren() {
  try {
    if (audioCtx && activeOscillators.length > 0) {
      const now = audioCtx.currentTime;
      if (activeGainNode) {
        activeGainNode.gain.cancelScheduledValues(now);
        activeGainNode.gain.setValueAtTime(activeGainNode.gain.value, now);
        activeGainNode.gain.linearRampToValueAtTime(0, now + 0.06);
      }
      activeOscillators.forEach(osc => {
        try { osc.stop(now + 0.07); } catch (_) {}
      });
    }
  } catch (e) {}
  activeOscillators = [];
  activeGainNode = null;
}

export function stopAllAlerts() {
  stopSiren();
  try {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  } catch (_) {}
}

export function playSynthesizedSiren() {
  try {
    unlockAudio();
    if (!audioCtx) return;

    const ctx = audioCtx;
    const now = ctx.currentTime;
    const dur = 3.6;
    const period = 0.9;
    const lo = 520;
    const hi = 1180;

    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = 'sawtooth';
    osc2.type = 'square';
    osc2.detune.value = -1200;

    osc.frequency.setValueAtTime(lo, now);
    osc2.frequency.setValueAtTime(lo, now);

    let t = now;
    while (t < now + dur) {
      osc.frequency.linearRampToValueAtTime(hi, t + period / 2);
      osc.frequency.linearRampToValueAtTime(lo, t + period);
      osc2.frequency.linearRampToValueAtTime(hi, t + period / 2);
      osc2.frequency.linearRampToValueAtTime(lo, t + period);
      t += period;
    }

    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.3, now + 0.06);
    g.gain.setValueAtTime(0.3, now + dur - 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(g);
    osc2.connect(g);
    g.connect(ctx.destination);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + dur);
    osc2.stop(now + dur);

    // Track for early stop
    activeOscillators = [osc, osc2];
    activeGainNode = g;

    // Auto-clear refs after siren ends
    setTimeout(() => {
      activeOscillators = [];
      activeGainNode = null;
    }, (dur + 0.1) * 1000);

    if (navigator.vibrate) {
      navigator.vibrate([400, 200, 400, 200, 400, 200, 600]);
    }
  } catch (e) {
    console.warn('playSynthesizedSiren failed:', e);
  }
}

export function announceTTS(text: string) {
  try {
    if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) {
      playSynthesizedSiren();
      return;
    }

    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.volume = 1.0;

    const applyVoice = () => {
      const voices = speechSynthesis.getVoices();

      // 1순위: 사용자가 직접 선택한 음성
      const userSelectedName = (window as any).__tt_selected_voice || localStorage.getItem('tt_selected_voice') || '';
      let voice = userSelectedName ? voices.find(v => v.name === userSelectedName) ?? null : null;

      // 2순위: twintower-ops 기준 — Google KO → Heami → 첫 번째 한국어 → 전체 첫 번째
      if (!voice) {
        const ko = voices.filter(v => v.lang.startsWith('ko'));
        voice = ko.find(v => v.name.includes('Google'))
          ?? ko.find(v => v.name.includes('Heami'))
          ?? ko[0]
          ?? voices[0]
          ?? null;
      }

      if (voice) { u.voice = voice; u.lang = voice.lang; }
      else { u.lang = 'ko-KR'; }

      u.pitch = 1.0;
      u.rate = 1.0;

      // Chrome 일시정지 버그 해결: speak() 전 반드시 resume()
      if (speechSynthesis.paused) speechSynthesis.resume();
      speechSynthesis.speak(u);

      // 1초 후 실제로 발화 중인지 확인 → 묵음이면 사이렌으로 폴백
      setTimeout(() => {
        if (!speechSynthesis.speaking) {
          playSynthesizedSiren();
        }
      }, 1000);
    };

    if (speechSynthesis.getVoices().length) {
      applyVoice();
    } else {
      speechSynthesis.addEventListener('voiceschanged', applyVoice, { once: true });
    }

    if (navigator.vibrate) {
      navigator.vibrate([400, 200, 400, 200, 400]);
    }
  } catch (e) {
    console.warn('TTS 실패, 사이렌으로 전환:', e);
    playSynthesizedSiren();
  }
}

// mode: '훈련/감지기' | '훈련/전체' | '실제/감지기' | '실제/화재' | '훈련' | '실제'
export function triggerEmergencyAlert(disasterName: string, location: string, mode: string) {
  let announcementText: string;

  if (mode === '훈련/감지기') {
    announcementText = `훈련상황! 훈련상황 ${location}에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.`;
  } else if (mode === '훈련/전체') {
    announcementText = `훈련상황! 화재발생! 훈련상황! 화재발생! ${location}으로 신속히 출동하시기 바랍니다.`;
  } else if (mode === '실제/감지기') {
    announcementText = `화재감지기동작!, 화재감지기동작! ${location}에서 화재감지기 동작! 초기대응대는 신속히 출동하시기 바랍니다.`;
  } else if (mode === '실제/화재') {
    announcementText = `화재발생!, 화재발생! ${location}에서 화재발생 신속히 출동하시기 바랍니다.`;
  } else if (mode.startsWith('훈련')) {
    announcementText = `훈련 ${disasterName}발생!, 훈련 ${disasterName}발생! ${location}에서 훈련 ${disasterName}발생 신속히 출동하시기 바랍니다.`;
  } else {
    announcementText = `${disasterName}발생!, ${disasterName}발생! ${location}에서 ${disasterName}발생 신속히 출동하시기 바랍니다.`;
  }

  announceTTS(announcementText);
}
