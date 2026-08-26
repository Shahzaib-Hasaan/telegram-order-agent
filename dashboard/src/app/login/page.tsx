'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace('/');
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({})))?.error ?? "That password doesn't work.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink-950 px-6">
      <div className="w-full max-w-[320px]">
        {/* The rail is the product's signature, so the door wears it too — here
            it stands at full height, the way a ticket looks when time is up. */}
        <div className="mb-8 flex items-stretch gap-3.5">
          <span className="w-[3px] rounded-full bg-s-fresh" />
          <div className="py-0.5">
            <h1 className="font-display text-[20px] font-bold leading-none tracking-tight text-fg">
              Tandoor Pass
            </h1>
            <p className="mt-1.5 text-[12.5px] text-mute">Tandoor &amp; Bun — kitchen board</p>
            <p className="urdu !text-[13px] !leading-[2]" lang="ur" dir="rtl">تندور اینڈ بن</p>
          </div>
        </div>

        <form onSubmit={submit} noValidate>
          <label htmlFor="pw" className="eyebrow mb-2 block">
            Team password
          </label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field !min-h-[40px] font-mono !text-[14px]"
            placeholder="••••••••"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'pw-error' : undefined}
          />

          {error && (
            <p id="pw-error" role="alert" className="mt-2 text-[12.5px] text-s-over">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !password}
            className="btn btn-accent mt-4 w-full !min-h-[40px]"
          >
            {busy ? 'Checking…' : 'Open the board'}
          </button>
        </form>

        <p className="mt-7 border-t border-line pt-4 text-[11.5px] leading-relaxed text-mute">
          This password opens every order and lets anyone move it through the kitchen. Give it to
          staff only.
        </p>
      </div>
    </main>
  );
}
