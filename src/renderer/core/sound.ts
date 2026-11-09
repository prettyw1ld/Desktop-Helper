/* Звуки Пуша. Мяу и мурчание — настоящие записи (Kerzoven, CC0; см. assets/audio/CREDITS.txt),
   шипение, колокольчик и шуршание синтезируются на лету (Web Audio). Все тихие. */

const state = { on: true, volume: 0.4 };
let lastMeow = -Infinity;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { c: AudioContext; out: GainNode } {
  if (!ctx || !master) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  master.gain.value = 0.35 * state.volume;
  return { c: ctx, out: master };
}

function noiseBuffer(c: AudioContext, sec: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Шипение, когда злится.
function synthHiss(): void {
  const { c, out } = audio();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.7);
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  src.connect(hp).connect(g).connect(out);
  src.start(t);
}

// Колокольчик на ошейнике: для напоминаний и встреч.
function synthBell(): void {
  const { c, out } = audio();
  const t = c.currentTime;
  for (const [f, a] of [[1760, 0.5], [2637, 0.25], [3520, 0.12]] as const) {
    for (const d of [0, 0.18]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(a, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.9);
      o.connect(g).connect(out);
      o.start(t + d);
      o.stop(t + d + 1);
    }
  }
}

// Шуршание мятой бумаги: кот падает в Корзину и вылезает из неё.
function synthCrumple(): void {
  const { c, out } = audio();
  const t = c.currentTime;
  for (let i = 0; i < 7; i++) {
    const at = t + i * 0.045 + Math.random() * 0.03;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.08);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 2500;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    src.connect(bp).connect(g).connect(out);
    src.start(at);
  }
}

// Записи: плавно входят и выходят, мурчание длится столько, сколько попросили.
type Clip = 'meow' | 'purr';
const playing = new Map<Clip, () => void>();

function recorded(name: Clip, seconds?: number): void {
  if (!state.on || playing.has(name)) return;
  if (name === 'meow') {
    if (performance.now() - lastMeow < 1100) return;
    lastMeow = performance.now();
  }
  const file = name === 'meow' ? 'meow-short.wav' : 'purr.wav';
  const clip = new Audio(new URL(`../../assets/audio/${file}`, document.baseURI).href);
  clip.preload = 'auto';
  const volume = Math.min(1, Math.max(0, state.volume)) * (name === 'meow' ? 0.65 : 0.8);
  clip.volume = 0;
  let fadeTimer: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => { clearInterval(fadeTimer); clip.pause(); playing.delete(name); };
  playing.set(name, cleanup);
  clip.addEventListener('ended', cleanup, { once: true });
  clip.addEventListener('error', cleanup, { once: true });
  clip.play().then(() => {
    if (!playing.has(name)) return;
    const started = performance.now();
    const duration = name === 'purr' ? Math.min(Math.max(Number(seconds) || 2.4, 1), 5.5) : (clip.duration || 2);
    fadeTimer = setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      const fade = Math.max(0, Math.min(1, elapsed / 0.12, (duration - elapsed) / 0.25));
      clip.volume = volume * fade;
      if (elapsed >= duration || !state.on) cleanup();
    }, 30);
  }).catch(cleanup);
}

const safe = (fn: () => void) => () => {
  if (!state.on) return;
  try { fn(); } catch { /* без звука */ }
};

export const Sound = {
  set(on: boolean, volume?: number): void {
    state.on = !!on;
    if (volume != null) state.volume = Math.min(1, Math.max(0, Number(volume) || 0));
    if (!state.on) for (const stop of [...playing.values()]) stop();
  },
  meow: (): void => recorded('meow'),
  purr: (sec?: number): void => recorded('purr', sec),
  hiss: safe(synthHiss),
  bell: safe(synthBell),
  crumple: safe(synthCrumple),
};
