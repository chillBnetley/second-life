import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui';

const KEY = 'secondlife:onboarding:v1';
const STEPS = [
  { emoji: '⚡', title: '每天有 10 点行动点', text: '学习、工作、运动、社交都要消耗行动点。用完就结束今天，睡眠会把剩余行动点转化成健康与幸福感。' },
  { emoji: '🎯', title: '去「行动」页做事', text: '先选学习或工作积累能力，再考虑娱乐与休息。行动点不足、钱不够或周末不能上班时，按钮会给出原因。' },
  { emoji: '🌙', title: '「结束今天」推进时间', text: '每天清晨会有概率触发事件；月初自动结算房租、工资、贷款与理财，生日与跨年也会发生特别的事。' },
  { emoji: '👥', title: '人际关系与 AI 剧情', text: '在「社交」里互动、送礼、表白；开启 AI 后，自由行动与人物对话会更丰富。进度自动保存在本机。' },
];

/** 首次进入的 4 步新手引导；看过一次后不再自动弹出（设置页可重播）。 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => prev?.focus?.();
  }, []);

  const finish = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* 忽略 */ }
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="新手引导">
      <div className="animate-pop w-full max-w-md rounded-2xl border border-white/12 bg-ink-800 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
          <span>新手引导 {step + 1} / {STEPS.length}</span>
          <button onClick={finish} className="rounded px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-slate-200">跳过</button>
        </div>
        <div className="text-4xl">{s.emoji}</div>
        <h2 className="mt-3 font-display text-xl font-semibold text-slate-50">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{s.text}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => <span key={i} className={`h-1.5 w-6 rounded-full ${i <= step ? 'bg-lantern-400' : 'bg-white/12'}`} />)}
          </div>
          <div className="flex gap-2">
            {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
            <Button variant="gold" onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? '开始人生' : '下一步'}<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 是否已经看过新手引导 */
export function hasSeenOnboarding(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}
export function resetOnboarding() {
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
}
