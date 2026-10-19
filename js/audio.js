// Klänge des Lernomats, komplett mit Web Audio erzeugt (keine Audiodateien nötig).
let ctx;
let master;

export function soundEnabled() {
  return localStorage.getItem('lernomat.sound') !== 'off';
}
export function setSoundEnabled(on) {
  localStorage.setItem('lernomat.sound', on ? 'on' : 'off');
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  return ctx;
}

// Prüft, ob der Browser Ton ohne vorheriges Tippen erlaubt.
export function audioUnlocked() {
  const c = ensure();
  return !!c && c.state === 'running';
}

export async function unlock() {
  const c = ensure();
  if (c && c.state !== 'running') {
    try { await c.resume(); } catch { /* ignorieren */ }
  }
  return !!c && c.state === 'running';
}

const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function freq(name) {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  const semis = NOTE[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
}

// Marimba-ähnlicher Ton: Grundton plus leiser Oberton, schnell abklingend.
function mallet(f, t, dur = 0.5, vol = 0.32) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  const o1 = ctx.createOscillator();
  o1.type = 'sine'; o1.frequency.value = f;
  const o2 = ctx.createOscillator();
  o2.type = 'sine'; o2.frequency.value = f * 4;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.18, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o1.connect(g); o2.connect(g2).connect(g);
  o1.start(t); o2.start(t);
  o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

function bass(f, t, dur = 0.4, vol = 0.22) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const o = ctx.createOscillator();
  o.type = 'triangle'; o.frequency.value = f;
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

function shaker(t, vol = 0.05) {
  const len = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'highpass'; bp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}

let playing = false;
// Lockere Startmelodie (ca. 4 Sekunden), C-Dur mit federndem Rhythmus.
export function playIntro() {
  if (!soundEnabled() || playing) return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  playing = true;
  const e = 60 / 138 / 2; // Achtelnote
  const t0 = c.currentTime + 0.08;
  const melody = [
    ['C5', 0, 1], ['E5', 1, 1], ['G5', 2, 1], ['E5', 3, .5], ['G5', 3.5, .5],
    ['A5', 4, 1], ['G5', 5, 1], ['E5', 6, 1], ['D5', 7, 1],
    ['F5', 8, 1], ['A5', 9, 1], ['C6', 10, 1], ['B5', 11, .5], ['A5', 11.5, .5],
    ['G5', 12, 1], ['E5', 13, .5], ['D5', 13.5, .5], ['C5', 14, 2.5],
  ];
  melody.forEach(([n, at, len]) => mallet(freq(n), t0 + at * e, Math.max(0.35, len * e * 1.6)));
  // Abschluss-Akkord
  ['E5', 'G5', 'C6'].forEach((n, i) => mallet(freq(n), t0 + 14 * e + i * 0.03, 1.4, 0.16));
  const bassLine = [['C3', 0], ['G3', 2], ['A2', 4], ['E3', 6], ['F2', 8], ['C3', 10], ['G2', 12], ['C3', 14]];
  bassLine.forEach(([n, at]) => bass(freq(n), t0 + at * e, e * 1.8));
  for (let i = 0; i < 14; i++) shaker(t0 + i * e + e * 0.5, i % 2 ? 0.035 : 0.05);
  setTimeout(() => { playing = false; }, 5000);
}

// Kurze Effekte für Rückmeldungen in der App.
export function sfx(kind) {
  if (!soundEnabled()) return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.01;
  if (kind === 'tap') mallet(freq('G5'), t, 0.25, 0.12);
  if (kind === 'flip') mallet(freq('E5'), t, 0.2, 0.08);
  if (kind === 'good') { mallet(freq('E5'), t, 0.3, 0.18); mallet(freq('A5'), t + 0.09, 0.45, 0.18); }
  if (kind === 'bad') { mallet(freq('D4'), t, 0.3, 0.14); mallet(freq('C4'), t + 0.1, 0.4, 0.12); }
  if (kind === 'done') ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => mallet(freq(n), t + i * 0.09, 0.6, 0.18));
}
