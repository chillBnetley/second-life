import { Compass, Coins, Moon, ScrollText, Settings2, Sparkles, Users, Zap, House } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { getAge, getDate } from '../game/engine';
import { formatDate, formatWeekday, fmtMoney } from '../game/util';
import { useGame } from '../store';
import type { AiStatus } from '../store';
import { EventModal } from './EventModal';
import { ConflictModal } from './ConflictModal';
import { Toasts } from './Toasts';
import { Button } from './ui';

const NAV: { path: string; label: string; icon: LucideIcon }[] = [
  { path: '/play', label: '人生', icon: Compass },
  { path: '/actions', label: '行动', icon: Zap },
  { path: '/social', label: '社交', icon: Users },
  { path: '/archive', label: '档案', icon: ScrollText },
];

const AI_LABEL: Record<AiStatus, string> = { off: 'AI 关闭', on: 'AI 开启', cooldown: 'AI 冷却中', budget: 'AI 额度用尽' };
const AI_TITLE: Record<AiStatus, string> = {
  off: 'AI 剧情已关闭，使用本地剧情（点击开启）',
  on: 'AI 剧情已开启（点击关闭）',
  cooldown: 'AI 连续失败，正在冷却，已回落本地剧情',
  budget: 'AI 今日调用次数已用完，已回落本地剧情',
};

export function Layout({ path, go, children }: { path: string; go: (p: string) => void; children: ReactNode }) {
  const { state, endDay, clearResult, aiStatus, toggleAi } = useGame();
  useEffect(() => { clearResult(); }, [path, clearResult]);
  if (!state) return null;
  const dp = getDate(state);
  const p = state.player;
  return (
    <div className="min-h-screen lg:pl-60">
      <Toasts />
      <EventModal />
      <ConflictModal />
      {/* 侧栏（桌面） */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-white/8 bg-ink-900/70 p-4 backdrop-blur lg:flex">
        <button onClick={() => go('/')} className="mb-6 flex items-center gap-2 text-left">
          <span className="text-2xl">🕯️</span>
          <span className="font-display text-lg font-black tracking-wide text-lantern-300">Second Life</span>
        </button>
        <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="font-display text-base font-semibold text-slate-100">{p.name}</div>
          <div className="text-xs text-slate-400">{getAge(state)} 岁 · 第 {state.day + 1} 天</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ path: to, label, icon: Icon }) => {
            const on = path === to;
            return (
              <button key={to} onClick={() => go(to)} aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${on ? 'bg-lantern-400/12 text-lantern-300 shadow-[inset_2px_0_0_#f6c25b]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            );
          })}
        </nav>
        <button onClick={() => go('/')} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-500 hover:text-slate-200"><House className="h-3.5 w-3.5" />回到首页（自动存档）</button>
      </aside>

      {/* 顶栏 */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-100">{formatDate(dp)} <span className="text-slate-500">{formatWeekday(dp)}</span></div>
            <div className="truncate text-xs text-slate-400 lg:hidden">{p.name} · {getAge(state)} 岁</div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => go('/settings')} aria-label="设置" title="设置"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white">
              <Settings2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={toggleAi} title={AI_TITLE[aiStatus]} aria-label={`AI 状态：${AI_LABEL[aiStatus]}，点击切换`}
              className={`hidden items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition sm:flex ${
                aiStatus === 'on' ? 'border-jade-400/40 bg-jade-400/10 text-jade-400'
                  : aiStatus === 'off' ? 'border-white/10 text-slate-500 hover:text-slate-300'
                    : 'border-rose2-400/40 bg-rose2-500/10 text-rose2-400'
              }`}>
              <Sparkles className="h-3 w-3" />{AI_LABEL[aiStatus]}
            </button>
            <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: p.money < 0 ? '#e0446f' : '#f6c25b' }}>
              <Coins className="h-4 w-4" />{fmtMoney(p.money)}
            </div>
            <div className="hidden items-center gap-1 sm:flex" title={`行动点 ${state.ap}/${state.maxAp}`} aria-label={`行动点 ${state.ap}/${state.maxAp}`}>
              {Array.from({ length: state.maxAp }).map((_, i) => (
                <span key={i} className={`h-2.5 w-2.5 rounded-full transition ${i < state.ap ? 'bg-lantern-400 shadow-[0_0_8px_#f6c25b]' : 'bg-white/12'}`} />
              ))}
            </div>
            <span className="text-xs text-slate-400 sm:hidden">AP {state.ap}/{state.maxAp}</span>
            <Button variant="rune" className="!px-3 !py-1.5" onClick={() => endDay()} disabled={!!state.pendingEvent} title="结束今天，剩余行动点会转化为睡眠恢复">
              <Moon className="h-4 w-4" /><span className="hidden sm:inline">结束今天</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 lg:pb-10">{children}</main>

      {/* 底栏（手机） */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-white/10 bg-ink-900/95 backdrop-blur lg:hidden">
        {NAV.map(({ path: to, label, icon: Icon }) => {
          const on = path === to;
          return (
            <button key={to} onClick={() => go(to)} aria-current={on ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition ${on ? 'text-lantern-300' : 'text-slate-500'}`}>
              <Icon className="h-5 w-5" />{label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
