/* Bull Run — tiny WebAudio SFX synth (window.BRSfx). No audio files. */
(function () {
  let C = null;
  function ctx() {
    if (!C) { try { C = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (C && C.state === 'suspended') { try { C.resume(); } catch (e) {} }
    return C;
  }
  function tone(freq, dur, type, vol, slideTo, when) {
    const c = ctx(); if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, when, freq) {
    const c = ctx(); if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + (when || 0);
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 2000; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0);
  }
  window.BRSfx = {
    unlock() { ctx(); },
    click() { tone(660, 0.055, 'square', 0.05); },
    pop() { tone(500, 0.09, 'triangle', 0.11, 760); },
    coin() { tone(880, 0.07, 'square', 0.09); tone(1318, 0.14, 'square', 0.09, null, 0.07); },
    error() { tone(220, 0.16, 'sawtooth', 0.07, 155); },
    chime() { tone(659, 0.12, 'triangle', 0.11); tone(880, 0.12, 'triangle', 0.11, null, 0.1); tone(1108, 0.22, 'triangle', 0.11, null, 0.2); },
    hammer() { noise(0.12, 0.28, 0, 900); tone(170, 0.1, 'square', 0.1, 110); },
    horn() { tone(392, 0.18, 'sawtooth', 0.1); tone(523, 0.18, 'sawtooth', 0.1, null, 0.18); tone(659, 0.34, 'sawtooth', 0.12, null, 0.36); },
    fanfare() { tone(523, 0.13, 'square', 0.1); tone(659, 0.13, 'square', 0.1, null, 0.13); tone(784, 0.13, 'square', 0.1, null, 0.26); tone(1046, 0.4, 'square', 0.12, null, 0.4); },
    whoosh() { noise(0.25, 0.14, 0, 600); }
  };
  // unlock audio on the first user gesture
  const un = () => { ctx(); window.removeEventListener('pointerdown', un); window.removeEventListener('keydown', un); };
  window.addEventListener('pointerdown', un); window.addEventListener('keydown', un);
})();
