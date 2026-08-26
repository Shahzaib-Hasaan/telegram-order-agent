/**
 * A new order needs to reach someone whose eyes are on a pan, not a screen.
 *
 * Two short struck tones a fifth apart — closer to a service bell than a
 * notification blip, and it cuts through kitchen noise without being shrill.
 * Synthesised rather than shipped as a file so there is no asset to load and
 * nothing to 404 on a bad connection.
 */
const KEY = 'tandoor_sound';

export function chimeEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(KEY) !== 'off';
}

export function setChimeEnabled(on: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, on ? 'on' : 'off');
}

let ctx: AudioContext | null = null;

export function chime() {
  if (typeof window === 'undefined' || !chimeEnabled()) return;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    // Browsers suspend audio until a gesture; logging in counts, but resume anyway.
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    [
      { f: 784, t: 0 }, // G5
      { f: 1175, t: 0.13 }, // D6
    ].forEach(({ f, t }) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      // struck, not held: fast attack, exponential decay
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.18, now + t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.42);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.45);
    });
  } catch {
    // Audio is a nicety. Never let it break the board.
  }
}
