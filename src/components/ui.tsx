import { Activity, Brain, Dumbbell, HeartPulse, Smile, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { ATTR_KEYS, ATTR_META } from '../game/content';
import type { ActionResult, AttrKey, Deltas } from '../game/types';
import { fmtMoney } from '../game/util';

export const ATTR_ICON: Record<AttrKey, LucideIcon> = {
  intelligence: Brain, eq: Smile, fitness: Dumbbell, charm: Sparkles, happiness: Activity, health: HeartPulse,
};

export const cardCls = 'rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.065] to-white/[0.02] backdrop-blur-sm';

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`${cardCls} ${className}`}>{children}</div>;
}

export function SectionTitle({ icon: Icon, children, right }: { icon?: LucideIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-slate-100">
        {Icon && <Icon className="h-4 w-4 text-lantern-400" />}
        {children}
      </h2>
      {right}
    </div>
  );
}

type Variant = 'gold' | 'ghost' | 'danger' | 'rune';
const VARIANT: Record<Variant, string> = {
  gold: 'bg-gradient-to-b from-lantern-300 to-lantern-500 text-ink-950 shadow-[0_6px_24px_-8px_rgba(246,194,91,.6)] hover:brightness-110',
  rune: 'bg-gradient-to-b from-rune-400 to-rune-600 text-white shadow-[0_6px_24px_-8px_rgba(124,108,240,.7)] hover:brightness-110',
  ghost: 'border border-white/12 bg-white/[0.04] text-slate-200 hover:bg-white/10',
  danger: 'border border-rose2-500/40 bg-rose2-500/10 text-rose2-400 hover:bg-rose2-500/20',
};
export function Button({ variant = 'ghost', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Chip({ children, color, className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${className}`}
      style={color ? { color, borderColor: `${color}55`, background: `${color}14` } : { borderColor: 'rgba(255,255,255,.12)', background: 'rgba(255,255,255,.04)' }}
    >
      {children}
    </span>
  );
}

export function StatBar({ value, color, max = 100, h = 'h-2' }: { value: number; color: string; max?: number; h?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`${h} w-full overflow-hidden rounded-full bg-white/[0.07]`}>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}99, ${color})`, boxShadow: `0 0 12px ${color}66` }}
      />
    </div>
  );
}

export function Modal({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 可访问性：打开时把焦点移入弹窗，Esc 关闭（仅可关闭弹窗），关闭后还原焦点
  useEffect(() => {
    const previous = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const box = boxRef.current;
    const focusable = () => Array.from(box?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
      .filter((el) => !el.hasAttribute('disabled'));
    (focusable()[0] ?? box)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !box) return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true">
      <div ref={boxRef} tabIndex={-1} className={`animate-pop relative max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-white/12 bg-ink-800 p-5 shadow-2xl scroll-thin outline-none ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        {onClose && (
          <button onClick={onClose} aria-label="关闭" className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/** 数值变化标签：属性 / 金钱 / 学识 / 行动点 / 好感度 */
export function DeltaChips({ deltas }: { deltas: Deltas }) {
  const items: { key: string; text: string; color: string }[] = [];
  for (const k of ATTR_KEYS) {
    const v = deltas.attrs[k];
    if (v) items.push({ key: k, text: `${ATTR_META[k].label} ${v > 0 ? '+' : ''}${v}`, color: v > 0 ? ATTR_META[k].color : '#e0446f' });
  }
  if (deltas.money) items.push({ key: 'money', text: `${deltas.money > 0 ? '+' : ''}${fmtMoney(deltas.money)}`, color: deltas.money > 0 ? '#3dd6a3' : '#e0446f' });
  if (deltas.knowledge) items.push({ key: 'kn', text: `学识 ${deltas.knowledge > 0 ? '+' : ''}${deltas.knowledge}`, color: '#7aa7ff' });
  if (deltas.ap) items.push({ key: 'ap', text: `行动点 ${deltas.ap > 0 ? '+' : ''}${deltas.ap}`, color: '#f6c25b' });
  deltas.npc.forEach((n, i) => { if (n.affinity) items.push({ key: `n${i}`, text: `${n.name} 好感 ${n.affinity > 0 ? '+' : ''}${n.affinity}`, color: n.affinity > 0 ? '#f58fb4' : '#e0446f' }); });
  if (!items.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((it) => <Chip key={it.key} color={it.color}>{it.text}</Chip>)}
    </div>
  );
}

export function ResultCard({ result, onClose }: { result: ActionResult; onClose?: () => void }) {
  const ok = result.ok;
  return (
    <div className={`animate-rise relative mb-4 rounded-2xl border p-4 ${ok ? 'border-lantern-400/30 bg-lantern-400/[0.06]' : 'border-rose2-500/30 bg-rose2-500/[0.07]'}`}>
      {onClose && (
        <button onClick={onClose} aria-label="收起" className="absolute right-2 top-2 rounded p-1 text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
      )}
      <div className={`mb-1 font-display text-base font-semibold ${ok ? 'text-lantern-300' : 'text-rose2-400'}`}>{result.title}</div>
      <p className="whitespace-pre-line pr-5 text-sm leading-relaxed text-slate-200">{result.text}</p>
      {ok && <DeltaChips deltas={result.deltas} />}
      {result.unlocked?.map((u) => <div key={u} className="mt-2 text-xs text-lantern-300">🏆 成就解锁：{u}</div>)}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">{children}</div>;
}
