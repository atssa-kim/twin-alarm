// Synthesized Emergency Sound Generator (AudioContext + TTS)

let audioCtx: AudioContext | null = null;

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
    osc2.detune.value = -1200; // Octave below for thickness

    osc.frequency.setValueAtTime(lo, now);
    osc2.frequency.setValueAtTime(lo, now);

    let t = now;
    // Siren wail: smooth sweep between low and high frequencies
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
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = 1.0;

    const applyVoiceAndSpeak = () => {
      const voices = speechSynthesis.getVoices();
      
      // Look for Microsoft '인준' (Injun) voice first as requested
      let selectedVoice = voices.find(v => v.lang.startsWith('ko') && (v.name.includes('인준') || v.name.includes('Injun') || v.name.includes('injun')));
      
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
      utterance.rate = 0.95; // Slightly slower for emergency clarity
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

export function triggerEmergencyAlert(disasterName: string, location: string, isTraining: boolean) {
  const prefix = isTraining ? '훈련 상황' : '실제 상황';
  const announcementText = `${prefix}! ${location}에서 ${disasterName} 발생! ${prefix}! ${location}에서 ${disasterName} 발생! 전 소집 대원은 신속히 출동해 주시기 바랍니다.`;
  announceTTS(announcementText);
}
