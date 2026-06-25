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

    // 음성안내 시작 시 사이렌 중지
    stopSiren();
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = 1.0;

    const applyVoiceAndSpeak = () => {
      const voices = speechSynthesis.getVoices();

      const userSelectedName = (window as any).__tt_selected_voice || localStorage.getItem('tt_selected_voice') || '';
      let selectedVoice = userSelectedName ? voices.find(v => v.name === userSelectedName) : null;

      if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith('ko') && (v.name.includes('인준') || v.name.includes('Injun') || v.name.includes('injun')));
      }

      if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith('ko') && (v.name.includes('Google') || v.name.includes('Heami'))) ||
                        voices.find(v => v.lang.startsWith('ko')) ||
                        voices[0];
      }

      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
      } else {
        utterance.lang = 'ko-KR';
      }
      utterance.pitch = 1.0;
      utterance.rate = 0.95;
      speechSynthesis.speak(utterance);
    };

    if (speechSynthesis.getVoices().length) {
      applyVoiceAndSpeak();
    } else {
      speechSynthesis.addEventListener('voiceschanged', applyVoiceAndSpeak, { once: true });
    }

    if (navigator.vibrate) {
      navigator.vibrate([400, 200, 400, 200, 400]);
    }
  } catch (e) {
    console.warn('TTS failed, falling back to siren:', e);
    playSynthesizedSiren();
  }
}

// mode: '훈련/감지기' | '훈련/전체' | '실제/감지기' | '실제/화재' | '훈련' | '실제'
export function triggerEmergencyAlert(disasterName: string, location: string, mode: string) {
  let eventName: string;

  if (mode === '훈련/감지기') {
    eventName = '훈련 감지기동작';
  } else if (mode === '훈련/전체') {
    eventName = '훈련 화재';
  } else if (mode === '실제/감지기') {
    eventName = '감지기동작';
  } else if (mode === '실제/화재') {
    eventName = '화재';
  } else if (mode.startsWith('훈련')) {
    eventName = `훈련 ${disasterName}`;
  } else {
    eventName = disasterName;
  }

  const announcementText =
    `${eventName}발생!, ${eventName}발생! ${location}에서 ${eventName}발생 신속히 출동하시기 바랍니다.`;

  announceTTS(announcementText);
}
