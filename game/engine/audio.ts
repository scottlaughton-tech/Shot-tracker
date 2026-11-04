// All game sound is synthesised (no audio files): the .308's crack and its echo off the
// treelines, the bolt, bullet impacts (heard late, because sound is slow), a deer's alarm
// snort, wind, chickadees and a distant crow.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let verb: ConvolverNode | null = null;
let muted = false;
let ambientOn = false;
let ambientNodes: AudioScheduledSourceNode[] = [];
let listenerYaw = 0;

/** Which way the player is looking (radians, 0 = north). Sounds are panned left/right from it. */
export function setListenerYaw(yaw: number) { listenerYaw = yaw; }

/** Stereo position for a sound coming from world azimuth `az` (radians from north). */
function panFor(az: number | undefined): number {
  if (az == null) return 0;
  return Math.max(-0.9, Math.min(0.9, Math.sin(az - listenerYaw) * 1.3));
}

function noiseBuffer(c: AudioContext, seconds: number, color: "white" | "pink" = "white"): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "white") d[i] = w;
    else { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; }
  }
  return buf;
}

/** Call from a tap (browsers only allow sound after the player touches something). */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      // outdoor reverb: a long, dark, decaying tail
      verb = ctx.createConvolver();
      const len = ctx.sampleRate * 2.8;
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) { const t = i / ctx.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.2) * (t < 0.04 ? t / 0.04 : 1); }
      }
      verb.buffer = ir;
      const vlp = ctx.createBiquadFilter(); vlp.type = "lowpass"; vlp.frequency.value = 1800;
      const vg = ctx.createGain(); vg.gain.value = 0.35;
      verb.connect(vlp).connect(vg).connect(master);
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch { ctx = null; }
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

function out(node: AudioNode, wet = 0, pan = 0) {
  if (!ctx || !master) return;
  let dry: AudioNode = node;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); dry = p; }
  dry.connect(master);
  if (wet > 0 && verb) { const g = ctx.createGain(); g.gain.value = wet; dry.connect(g).connect(verb); }
}

function burst(at: number, dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 0.7, wet = 0, decay = 30, pan = 0) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.gain.setTargetAtTime(0, at, 1 / decay);
  src.connect(f).connect(g);
  out(g, wet, pan);
  src.start(at); src.stop(at + dur + 0.05);
}

function tone(at: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = "sine", wet = 0, pan = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + Math.min(0.03, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g);
  out(g, wet, pan);
  o.start(at); o.stop(at + dur + 0.05);
}

/** The rifle: supersonic crack + muzzle boom, then echoes rolling back off the treelines. */
export function shotSound() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.005;
  burst(t, 0.09, 1.0, "lowpass", 5200, 0.7, 0.9, 40);
  burst(t, 0.35, 0.8, "lowpass", 900, 0.5, 1.0, 9);
  tone(t, 95, 38, 0.32, 0.9, "sine", 0.6);
  // echoes: side treelines (~250 m away) and the back of the field (~1 km)
  burst(t + 1.4, 0.5, 0.18, "lowpass", 700, 0.5, 0.5, 6);
  burst(t + 2.3, 0.7, 0.12, "lowpass", 500, 0.5, 0.6, 4);
  burst(t + 5.6, 0.9, 0.07, "lowpass", 380, 0.5, 0.7, 3);
}

/** Bolt up, back, forward, down. */
export function boltSound(delay = 0.35) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  burst(t, 0.03, 0.25, "bandpass", 3200, 4);
  burst(t + 0.12, 0.05, 0.3, "bandpass", 2400, 3);
  burst(t + 0.34, 0.04, 0.3, "bandpass", 2800, 3);
  burst(t + 0.44, 0.03, 0.22, "bandpass", 3600, 4);
}

export function reloadSound() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.4;
  for (let i = 0; i < 5; i++) burst(t + 0.5 + i * 0.45, 0.04, 0.22, "bandpass", 2600 + i * 80, 3);
  boltSound(3.0);
}

/** A bullet hitting a deer: the "whop" comes back after the bullet's flight + the sound's trip. */
export function hitSound(delay: number, range: number, az?: number) {
  if (!ctx) return;
  const t = ctx.currentTime + delay, pan = panFor(az);
  const g = Math.max(0.08, Math.min(0.6, 60 / range));
  burst(t, 0.16, g, "lowpass", 420, 0.6, 0.6, 14, pan);
  tone(t, 140, 70, 0.12, g * 0.7, "sine", 0, pan);
}

export function impactSound(delay: number, range: number, az?: number) {
  if (!ctx) return;
  const g = Math.max(0.03, Math.min(0.3, 30 / range));
  burst(ctx.currentTime + delay, 0.12, g, "lowpass", 900, 0.6, 0.4, 18, panFor(az));
}

/** A whitetail's alarm "blow". */
export function snortSound(delay: number, range: number, az?: number) {
  if (!ctx) return;
  const g = Math.max(0.04, Math.min(0.5, 50 / range));
  const t = ctx.currentTime + delay, pan = panFor(az);
  burst(t, 0.45, g, "bandpass", 1100, 1.2, 0.5, 5, pan);
  if (Math.random() < 0.6) burst(t + 0.9, 0.35, g * 0.8, "bandpass", 1000, 1.2, 0.5, 6, pan);
}

/** A rutting buck's grunt: short, low, guttural. */
export function gruntSound(delay: number, range: number, az?: number) {
  if (!ctx) return;
  const g = Math.max(0.02, Math.min(0.25, 25 / range));
  const t = ctx.currentTime + delay, pan = panFor(az);
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const at = t + i * 0.55;
    tone(at, 105, 82, 0.32, g, "sawtooth", 0.5, pan);
    burst(at, 0.3, g * 0.6, "lowpass", 320, 0.8, 0.5, 8, pan);
  }
}

/** A dry stick snapping under a hoof as a buck steps out of the bush. */
export function twigSound(delay: number, range: number, az?: number) {
  if (!ctx) return;
  const g = Math.max(0.02, Math.min(0.3, 20 / range));
  const t = ctx.currentTime + delay, pan = panFor(az);
  burst(t, 0.035, g, "highpass", 1800, 0.7, 0.4, 60, pan);
  burst(t + 0.012, 0.06, g * 0.5, "bandpass", 900, 2, 0.4, 40, pan);
}

/** A soft two-note chime when a buck steps out, from his side. */
export function alertSound(az?: number) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.02, pan = panFor(az);
  tone(t, 784, 784, 0.35, 0.05, "sine", 0.15, pan);
  tone(t + 0.13, 1175, 1175, 0.55, 0.04, "sine", 0.15, pan);
}

// ---------- ambience ----------

export function startAmbience() {
  if (!ctx || ambientOn) return;
  ambientOn = true;
  // wind: pink noise through a slowly wandering low-pass
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 6, "pink");
  src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500;
  const g = ctx.createGain(); g.gain.value = 0.22;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 250;
  lfo.connect(lfoG).connect(f.frequency);
  const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
  const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.09;
  lfo2.connect(lfo2G).connect(g.gain);
  src.connect(f).connect(g);
  out(g);
  src.start(); lfo.start(); lfo2.start();
  ambientNodes = [src, lfo, lfo2];
  const birds = () => {
    if (!ctx || !ambientOn) return;
    const t = ctx.currentTime + 0.1;
    const r = Math.random();
    if (r < 0.55) {
      // black-capped chickadee "fee-bee"
      const v = 0.035 + Math.random() * 0.03;
      tone(t, 3950, 3900, 0.32, v, "sine", 0.4);
      tone(t + 0.42, 3450, 3350, 0.36, v * 0.9, "sine", 0.4);
    } else if (r < 0.75) {
      // chickadee-dee-dee
      const v = 0.025 + Math.random() * 0.02;
      tone(t, 4200, 3700, 0.08, v, "triangle", 0.3);
      for (let i = 0; i < 3; i++) burst(t + 0.15 + i * 0.13, 0.1, v * 1.5, "bandpass", 3300, 5, 0.3, 20);
    } else {
      // distant crow: a few harsh caws
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) { tone(t + i * 0.42, 560, 430, 0.28, 0.018, "sawtooth", 0.7); burst(t + i * 0.42, 0.25, 0.02, "bandpass", 1200, 2, 0.7, 6); }
    }
    window.setTimeout(birds, 6000 + Math.random() * 14000);
  };
  window.setTimeout(birds, 3000);
}

export function stopAmbience() {
  ambientOn = false;
  for (const n of ambientNodes) { try { n.stop(); } catch {} }
  ambientNodes = [];
}
