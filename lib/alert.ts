// Sound + vibration for "new shot reported" alerts.
// Browsers only allow sound after the person has tapped the page at least once,
// so we "unlock" audio on the first tap.

let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctx && AC) ctx = new AC();
    if (ctx?.state === "suspended") void ctx.resume();
  } catch {}
}

/** Two short, quiet beeps. */
export function beep() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [0, 0.22].forEach((dt) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t0 + dt);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.15);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t0 + dt);
    osc.stop(t0 + dt + 0.16);
  });
}

/** Android vibrates; iPhones ignore this (Safari doesn't allow it). */
export function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {}
}
