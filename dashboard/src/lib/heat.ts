/**
 * How urgent is this ticket?
 *
 * Every order carries a promise: 35-45 minutes. Each ticket is scored against
 * the upper bound of that promise, because that is the number the customer was
 * actually given. The score drives the status rail, so a busy board reads as a
 * bar chart of urgency without anyone doing arithmetic.
 */
export type Tone = 0 | 1 | 2 | 3;

export function toneOf(ageSeconds: number, promiseMinutes: number): Tone {
  const r = ageSeconds / (promiseMinutes * 60);
  if (r < 0.5) return 0;
  if (r < 0.8) return 1;
  if (r < 1) return 2;
  return 3;
}

/** 0-100: how far up the rail the fill has climbed. */
export function railFill(ageSeconds: number, promiseMinutes: number): number {
  const r = ageSeconds / (promiseMinutes * 60);
  return Math.max(8, Math.min(100, Math.round(r * 100)));
}

export const TONE_VAR: Record<Tone, string> = {
  0: 'var(--color-s-fresh)',
  1: 'var(--color-s-warm)',
  2: 'var(--color-s-late)',
  3: 'var(--color-s-over)',
};

/** What the colour means, said out loud. Used for titles and screen readers. */
export const TONE_MEANING: Record<Tone, string> = {
  0: 'on time',
  1: 'halfway to the promise',
  2: 'running late',
  3: 'past the promised time',
};

export function elapsed(ageSeconds: number): string {
  const m = Math.floor(ageSeconds / 60);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

export function rupees(n: number): string {
  return Number(n).toLocaleString('en-PK');
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Karachi',
  });
}
