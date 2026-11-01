import { Trophy, AlertTriangle, Info } from 'lucide-react';
import { useGame } from '../store';

export function Toasts() {
  const { toasts, dismissToast } = useGame();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'gold' ? Trophy : t.kind === 'warn' ? AlertTriangle : Info;
        const tone = t.kind === 'gold' ? 'border-lantern-400/50 text-lantern-300' : t.kind === 'warn' ? 'border-rose2-500/50 text-rose2-400' : 'border-white/20 text-slate-200';
        return (
          <button key={t.id} onClick={() => dismissToast(t.id)}
            className={`animate-pop pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border bg-ink-800/95 px-4 py-2.5 text-left text-sm shadow-xl backdrop-blur ${tone}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t.text}</span>
          </button>
        );
      })}
    </div>
  );
}
