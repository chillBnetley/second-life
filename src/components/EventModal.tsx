import { Dices, Lock } from 'lucide-react';
import { useState } from 'react';
import { ATTR_META } from '../game/content';
import { choiceBlockReason } from '../game/engine';
import type { ActionResult, GameEvent } from '../game/types';
import { fmtMoney } from '../game/util';
import { checkChance } from '../game/validate';
import { useGame } from '../store';
import { Button, Chip, DeltaChips, Modal } from './ui';

const CAT: Record<string, { label: string; color: string }> = {
  daily: { label: '日常', color: '#7aa7ff' }, social: { label: '社交', color: '#f58fb4' }, study: { label: '学习', color: '#3dd6a3' },
  work: { label: '工作', color: '#ff9e5e' }, random: { label: '随机', color: '#b7a0ff' }, major: { label: '重大人生事件', color: '#f6c25b' },
};

/** 全局事件弹窗：展示待处理事件 → 选择 → 展示结果。 */
export function EventModal() {
  const { state, chooseEvent } = useGame();
  const [done, setDone] = useState<{ event: GameEvent; choice: string; result: ActionResult } | null>(null);
  const ev = state?.pendingEvent ?? null;

  if (done && !ev) {
    const { event, choice, result } = done;
    return (
      <Modal>
        <div className="mb-1 text-xs text-slate-400">{event.title} · 你选择了「{choice}」</div>
        <p className="mb-1 whitespace-pre-line font-display text-lg leading-relaxed text-slate-100">{result.text}</p>
        <DeltaChips deltas={result.deltas} />
        {result.unlocked?.map((u) => <div key={u} className="mt-2 text-xs text-lantern-300">🏆 成就解锁：{u}</div>)}
        <Button variant="gold" className="mt-5 w-full" onClick={() => setDone(null)}>继续人生</Button>
      </Modal>
    );
  }
  if (!ev || !state) return null;
  const cat = CAT[ev.category];
  return (
    <Modal wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip color={cat.color}>{cat.label}</Chip>
        {ev.source === 'ai' && <Chip color="#9a8cff">AI 生成</Chip>}
      </div>
      <h3 className="font-display text-2xl font-black text-slate-50">{ev.title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-300">{ev.description}</p>
      <div className="mt-5 grid gap-2">
        {ev.choices.map((c) => {
          const blocked = choiceBlockReason(state, c.id);
          const chance = c.check ? Math.round(checkChance(state.player.attrs[c.check.attr], c.check.target) * 100) : null;
          return (
            <button
              key={c.id}
              disabled={!!blocked}
              onClick={() => { const r = chooseEvent(c.id); setDone({ event: ev, choice: c.label, result: r }); }}
              className="group rounded-xl border border-white/12 bg-white/[0.04] px-4 py-3 text-left transition hover:border-lantern-400/60 hover:bg-lantern-400/[0.07] active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-white/12 disabled:hover:bg-white/[0.04]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-100">{c.label}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  {c.cost ? <span className="text-rose2-400">-{fmtMoney(c.cost)}</span> : null}
                  {chance !== null && <span className="flex items-center gap-1 text-rune-300"><Dices className="h-3.5 w-3.5" />{ATTR_META[c.check!.attr].label}检定 {chance}%</span>}
                  {blocked && <Lock className="h-3.5 w-3.5 text-slate-500" />}
                </span>
              </div>
              {(c.hint || blocked) && <div className="mt-0.5 text-xs text-slate-400">{blocked ?? c.hint}</div>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
