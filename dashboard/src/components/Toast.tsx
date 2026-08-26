'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Tone = 'ok' | 'error' | 'info';
type Toast = { id: number; text: string; tone: Tone; undo?: () => void };

const Ctx = createContext<{
  push: (text: string, tone?: Tone, undo?: () => void) => void;
}>({ push: () => {} });

export const useToast = () => useContext(Ctx);

const TONE: Record<Tone, { bar: string; label: string }> = {
  ok: { bar: 'var(--color-s-fresh)', label: 'Done' },
  error: { bar: 'var(--color-s-over)', label: 'Problem' },
  info: { bar: 'var(--color-s-info)', label: '' },
};

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((text: string, tone: Tone = 'info', undo?: () => void) => {
    const id = Date.now() + Math.random();
    setItems((v) => [...v.slice(-2), { id, text, tone, undo }]);
  }, []);

  const drop = useCallback((id: number) => {
    setItems((v) => v.filter((t) => t.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,420px)]
                   -translate-x-1/2 flex-col gap-2"
      >
        {items.map((t) => (
          <Row key={t.id} toast={t} onDone={() => drop(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function Row({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  // Errors stay long enough to read and act on; confirmations get out of the way.
  const life = toast.tone === 'error' ? 7000 : toast.undo ? 6000 : 3200;

  useEffect(() => {
    const t = setTimeout(onDone, life);
    return () => clearTimeout(t);
  }, [life, onDone]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="rise pointer-events-auto flex items-center gap-3 overflow-hidden rounded-lg
                 border border-line-strong bg-ink-850 py-2.5 pl-0 pr-3 shadow-2xl shadow-black/60"
    >
      <span className="h-full w-[3px] self-stretch" style={{ background: TONE[toast.tone].bar }} />
      <p className="flex-1 text-[13px] leading-snug text-fg">{toast.text}</p>
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo!();
            onDone();
          }}
          className="btn btn-ghost !min-h-0 !px-2 !py-1 !text-[12px]"
        >
          Undo
        </button>
      )}
      <button
        onClick={onDone}
        aria-label="Dismiss"
        className="shrink-0 px-1 text-[16px] leading-none text-mute transition-colors hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}
